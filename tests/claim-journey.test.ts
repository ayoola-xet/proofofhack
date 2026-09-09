import { type ChildProcess, spawn } from "node:child_process";
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  erc20Abi,
  type Hex,
  http,
  keccak256,
  toHex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, expect, it } from "vitest";
import { bountyEscrowAbi } from "../packages/chain/src/abi/BountyEscrow.ts";
import { ReadOnlyBountyChain } from "../packages/chain/src/bounty-reader.ts";
import { encodeClaimCall } from "../packages/chain/src/claim-calls.ts";
import { contractPolicy } from "../packages/chain/src/policy.ts";
import { FileCiphertextStore } from "../packages/ciphertext-store/src/index.ts";
import {
  canonicalJson,
  createEncryptionKeyPair,
  seal,
} from "../packages/crypto-envelope/src/index.ts";
import { connectDatabase, databaseUrl } from "../packages/database/src/index.ts";
import { ADAPTER_ID, type BountyPolicy, hashPolicy } from "../packages/domain/src/index.ts";
import { createManifestCases } from "../packages/fixture-manifest/src/index.ts";
import { serviceToken } from "../packages/service-auth/src/index.ts";
import type { PublicServiceConfig } from "../packages/service-config/src/index.ts";
import { createApp } from "../services/api/src/app.ts";
import { LocalAuthProvider } from "../services/api/src/auth.ts";
import { createReleaseApp } from "../services/report-release/src/app.ts";
import { createReportDownloadApp } from "../services/report-release/src/download.ts";
import { OrganizationKeyStore } from "../services/report-release/src/keys.ts";
import { createVerifierApp } from "../services/verifier/src/app.ts";
import { FixtureVerifier } from "../services/verifier/src/process.ts";
import { type ClaimRelayer, processClaim } from "../services/worker/src/claim-process.ts";
import { a, h } from "./helpers/policy.ts";

const admin = connectDatabase().pool,
  name = `claim_test_${randomUUID().replaceAll("-", "")}`,
  url = new URL(databaseUrl());
url.pathname = `/${name}`;
const { pool, db } = connectDatabase(url.toString()),
  directory = await mkdtemp(join(tmpdir(), "proofofhack-claims-"));
const accounts = [
  privateKeyToAccount(generatePrivateKey()),
  privateKeyToAccount(generatePrivateKey()),
];
const admissionKey = generatePrivateKey(),
  verdictKey = generatePrivateKey();
const identity = generateKeyPairSync("ed25519"),
  publicKey = identity.publicKey.export({ type: "spki", format: "pem" }).toString(),
  privateKey = identity.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const evidenceKeys = await createEncryptionKeyPair(),
  researcherKeys = await createEncryptionKeyPair();
const evidence = new FileCiphertextStore(join(directory, "evidence"), 262192),
  reports = new FileCiphertextStore(join(directory, "reports"), 1048576);
const config: PublicServiceConfig = {
  schemaVersion: "1",
  testnetOnly: true,
  evidenceScope: "FIXTURE_ONLY",
  verifierMode: "TRUSTED_SERVICE",
  evidenceKeyId: keccak256(toHex(evidenceKeys.publicKey)),
  evidencePublicKey: evidenceKeys.publicKey,
  admissionSigner: privateKeyToAccount(admissionKey).address.toLowerCase() as Hex,
  verdictSigner: privateKeyToAccount(verdictKey).address.toLowerCase() as Hex,
  adapterCodeHash: h(5),
  verifierConfigHash: h(6),
  serviceIdentities: {
    api: publicKey,
    worker: publicKey,
    verifier: publicKey,
    "report-release": publicKey,
  },
};
const users = [0, 1, 2].map((i) => ({
  token: randomBytes(32).toString("hex"),
  subject: `local:claim-test:${randomUUID()}`,
  displayName: `Claim actor ${i}`,
}));
const auth = new LocalAuthProvider(users, "local"),
  ids: string[] = [];
const api = await createApp({
  pool,
  auth,
  appEnv: "local",
  webOrigin: "http://127.0.0.1:5173",
  claimServices: { config, evidence },
  walletIdentity: {
    userWallets: async () => [
      { providerWalletId: "test-researcher", address: accounts[1].address.toLowerCase() },
    ],
  },
});
let anvil: ChildProcess | undefined,
  escrow: Hex,
  asset: Hex,
  policy: BountyPolicy,
  orgId: string,
  reader: ReadOnlyBountyChain,
  verifier: FixtureVerifier,
  relayer: ClaimRelayer;
let vApp: ReturnType<typeof createVerifierApp>,
  rApp: ReturnType<typeof createReleaseApp>,
  researcher: ReturnType<typeof createReportDownloadApp>,
  organization: ReturnType<typeof createReportDownloadApp>;
let publicClient: ReturnType<typeof createPublicClient>;
let advanceTime: (seconds: number) => Promise<void>;
let fundNext: () => Promise<void>, collectExternally: () => Promise<Hex>;
const cases = createManifestCases([h(100), h(101), h(102)], [h(200), h(201), h(202)]);
const headers = (i = 1) => ({
  authorization: `Bearer ${users[i].token}`,
  "idempotency-key": randomUUID(),
});
const keys = new OrganizationKeyStore(join(directory, "organization-keys"));
const calls = new Map<string, Hex>();
async function internal<T>(
  app: ReturnType<typeof createVerifierApp>,
  audience: string,
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const response = await app.inject({
    method: "POST",
    url: path,
    headers: { authorization: `Bearer ${await serviceToken(privateKey, "worker", audience)}` },
    payload: body,
  });
  if (response.statusCode !== 200)
    throw new Error(
      `Confidential service rejected ${path}: ${response.statusCode} ${response.json().error?.code}`,
    );
  return response.json() as T;
}
beforeAll(async () => {
  await admin.query(`create database ${name}`);
  await migrate(db, { migrationsFolder: "packages/database/migrations" });
  const port = await new Promise<number>((resolve, reject) => {
    const s = createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const info = s.address();
      if (!info || typeof info === "string") return reject(new Error("Port allocation failed"));
      s.close(() => resolve(info.port));
    });
  });
  const rpc = `http://127.0.0.1:${port}`,
    chain = defineChain({
      id: 31337,
      name: "Local fixture test",
      nativeCurrency: { name: "Test ETH", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [rpc] } },
    });
  anvil = spawn(
    "anvil",
    [
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--chain-id",
      "31337",
      "--prune-history",
      "4096",
      "--silent",
    ],
    { stdio: "ignore" },
  );
  publicClient = createPublicClient({ transport: http(rpc, { retryCount: 0, timeout: 1000 }) });
  for (let i = 0; i < 50; i++) {
    try {
      await publicClient.getChainId();
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "anvil_setBalance",
      params: [accounts[0].address, "0x3635c9adc5dea00000"],
    }),
  });
  const finalize = async () => {
    const response = await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "anvil_mine", params: ["0x40"] }),
    });
    if ((await response.json()).error) throw new Error("Local finality advancement failed.");
  };
  advanceTime = async (seconds) => {
    const response = await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "evm_increaseTime",
        params: [seconds],
      }),
    });
    if ((await response.json()).error) throw new Error("Local time advancement failed.");
    await finalize();
    await finalize();
  };
  const wallet = createWalletClient({ account: accounts[0], chain, transport: http(rpc) });
  const tokenArtifact = JSON.parse(
    await readFile("contracts/out/TestUSDC.sol/TestUSDC.json", "utf8"),
  );
  const escrowArtifact = JSON.parse(
    await readFile("contracts/out/BountyEscrow.sol/BountyEscrow.json", "utf8"),
  );
  asset = (
    await publicClient.waitForTransactionReceipt({
      hash: await wallet.deployContract({
        abi: tokenArtifact.abi,
        bytecode: tokenArtifact.bytecode.object,
      }),
    })
  ).contractAddress as Hex;
  escrow = (
    await publicClient.waitForTransactionReceipt({
      hash: await wallet.deployContract({
        abi: bountyEscrowAbi,
        bytecode: escrowArtifact.bytecode.object,
        args: [asset],
      }),
    })
  ).contractAddress as Hex;
  for (let i = 0; i < 3; i++)
    ids.push((await api.inject({ url: "/api/v1/me", headers: headers(i) })).json().user.id);
  orgId = (
    await api.inject({
      method: "POST",
      url: "/api/v1/organizations",
      headers: headers(0),
      payload: { name: "Fixture journey" },
    })
  ).json().id;
  // The researcher also has an organization role. Organization downloads must still wait for payment.
  await api.inject({
    method: "POST",
    url: `/api/v1/organizations/${orgId}/members`,
    headers: headers(0),
    payload: { userId: ids[1], role: "REVIEWER" },
  });
  const programId = (
    await api.inject({
      method: "POST",
      url: `/api/v1/organizations/${orgId}/programs`,
      headers: headers(0),
      payload: { name: "Local fixture" },
    })
  ).json().id;
  const reportKey = await keys.ensure(pool, orgId),
    onchain = (await pool.query("select onchain_id from organizations where id=$1", [orgId]))
      .rows[0].onchain_id;
  policy = {
    settlementChainId: "31337",
    escrow: escrow.toLowerCase() as Hex,
    organizationId: onchain,
    refundRecipient: accounts[0].address.toLowerCase() as Hex,
    sourceChainId: "1",
    sourceVault: a(9),
    sourceBlockHash: h(9),
    fixtureManifestRoot: cases.root,
    adapterId: ADAPTER_ID,
    adapterCodeHash: config.adapterCodeHash,
    verifierConfigHash: config.verifierConfigHash,
    admissionSigner: config.admissionSigner,
    verdictSigner: config.verdictSigner,
    reportRecipientKeyId: reportKey.keyId,
    asset: asset.toLowerCase() as Hex,
    reward: "1000000",
    minimumDiscrepancy: "1000000",
    submissionDeadline: String(Math.floor(Date.now() / 1000) + 3600),
    settlementDeadline: String(Math.floor(Date.now() / 1000) + 7200),
    reservationDurationSeconds: "1800",
    organizationNonce: h(44),
  };
  await publicClient.waitForTransactionReceipt({
    hash: await wallet.writeContract({
      address: asset,
      abi: erc20Abi,
      functionName: "approve",
      args: [escrow, 1000000n],
    }),
  });
  const funded = await publicClient.waitForTransactionReceipt({
    hash: await wallet.writeContract({
      address: escrow,
      abi: bountyEscrowAbi,
      functionName: "createAndFund",
      args: [contractPolicy(policy)],
    }),
  });
  await finalize();
  await pool.query(
    "insert into bounties(bounty_id,program_id,policy_hash,policy_json,chain_id,escrow,reward,unallocated_reward,chain_state,creation_tx) values($1,$2,$1,$3,'31337',$4,'1000000','1000000','FUNDED',$5)",
    [hashPolicy(policy), programId, JSON.stringify(policy), policy.escrow, funded.transactionHash],
  );
  fundNext = async () => {
    policy = { ...policy, organizationNonce: h(45) };
    await publicClient.waitForTransactionReceipt({
      hash: await wallet.writeContract({
        address: asset,
        abi: erc20Abi,
        functionName: "approve",
        args: [escrow, 1000000n],
      }),
    });
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: await wallet.writeContract({
        address: escrow,
        abi: bountyEscrowAbi,
        functionName: "createAndFund",
        args: [contractPolicy(policy)],
      }),
    });
    await finalize();
    await pool.query(
      "insert into bounties(bounty_id,program_id,policy_hash,policy_json,chain_id,escrow,reward,unallocated_reward,chain_state,creation_tx) values($1,$2,$1,$3,'31337',$4,'1000000','1000000','FUNDED',$5)",
      [
        hashPolicy(policy),
        programId,
        JSON.stringify(policy),
        policy.escrow,
        receipt.transactionHash,
      ],
    );
  };
  collectExternally = async () => {
    const hash = await wallet.writeContract({
      address: escrow,
      abi: bountyEscrowAbi,
      functionName: "collectPayment",
      args: [hashPolicy(policy)],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    await finalize();
    return hash;
  };
  await pool.query(
    "insert into wallets(provider,provider_wallet_id,owner_type,owner_id,chain_id,address) values('PRIVY','test-researcher','USER',$1,'31337',$2)",
    [ids[1], accounts[1].address.toLowerCase()],
  );
  const relayerId = (
    await pool.query(
      "insert into wallets(provider,provider_wallet_id,owner_type,owner_id,chain_id,address) values('CIRCLE','test-relayer','SERVICE',$1,'31337',$2) returning id",
      [ids[0], accounts[0].address.toLowerCase()],
    )
  ).rows[0].id;
  reader = new ReadOnlyBountyChain(rpc, 31337, policy.escrow);
  verifier = new FixtureVerifier(pool, {
    config,
    evidence,
    reports,
    reader,
    evidenceKeys,
    researcherKeys,
    admissionKey,
    verdictKey,
  });
  vApp = createVerifierApp(verifier, publicKey);
  rApp = createReleaseApp(
    pool,
    { worker: publicKey, api: publicKey },
    join(directory, "organization-keys"),
  );
  researcher = createReportDownloadApp({
    pool,
    auth,
    mode: "researcher",
    store: reports,
    resolveKey: async () => researcherKeys,
  });
  organization = createReportDownloadApp({
    pool,
    auth,
    mode: "organization",
    store: reports,
    resolveKey: async (id, org) => {
      const key = await keys.read(id);
      expect(key.organizationId).toBe(org);
      return key;
    },
  });
  relayer = {
    walletId: relayerId,
    send: async (key, to, call) => {
      let hash = calls.get(key);
      if (!hash) {
        hash = await wallet.sendTransaction({ to, data: encodeClaimCall(call), value: 0n });
        calls.set(key, hash);
        await publicClient.waitForTransactionReceipt({ hash });
        await finalize();
      }
      return { hash, providerId: key };
    },
  };
}, 30000);
afterAll(async () => {
  await Promise.all([
    api.close(),
    vApp?.close(),
    rApp?.close(),
    researcher?.close(),
    organization?.close(),
  ]);
  anvil?.kill("SIGTERM");
  await pool.end();
  await admin.query(`drop database if exists ${name}`);
  await admin.end();
  await rm(directory, { recursive: true, force: true });
});
async function upload(input: unknown) {
  const bytes = await seal(new TextEncoder().encode(canonicalJson(input)), evidenceKeys.publicKey);
  const walletId = (
    await pool.query("select id from wallets where provider_wallet_id='test-researcher'")
  ).rows[0].id;
  const prepared = await api.inject({
    method: "POST",
    url: `/api/v1/bounties/${hashPolicy(policy)}/uploads`,
    headers: headers(),
    payload: {
      keyId: config.evidenceKeyId,
      algorithm: "X25519_SEALED_BOX",
      ciphertextHash: keccak256(bytes),
      byteLength: bytes.length,
      claimantWalletId: walletId,
    },
  });
  expect(prepared.statusCode).toBe(201);
  const item = prepared.json();
  const response = await api.inject({
    method: "PUT",
    url: item.uploadPath,
    headers: { ...headers(), "content-type": "application/octet-stream" },
    payload: Buffer.from(bytes),
  });
  expect(response.statusCode).toBe(200);
  return item.claimId as string;
}
const verifierClient = {
  post: <T>(path: string, body: Record<string, unknown>) =>
    internal<T>(vApp, "verifier", path, body),
};
const releaseClient = {
  post: <T>(path: string, body: Record<string, unknown>) =>
    internal<T>(rApp, "report-release", path, body),
};
it("Rejects malformed fixture evidence before reserving a reward", async () => {
  const claimId = await upload({ schemaVersion: "1", url: "https://example.invalid/source" });
  await expect(verifier.admit(claimId)).rejects.toMatchObject({ code: "INVALID_FIXTURE" });
  expect((await reader.read(policy)).state).toBe(1);
  expect(
    (await pool.query("select count(*) from assessments where claim_id=$1", [claimId])).rows[0]
      .count,
  ).toBe("0");
});
it("Stops an expired admission after a lost response without reserving funds", async () => {
  const claimId = await upload(cases.fixtures[1].fixture);
  let sends = 0;
  const unavailable: ClaimRelayer = {
    walletId: relayer.walletId,
    send: async () => {
      sends++;
      throw new Error("Lost provider response");
    },
  };
  await expect(
    processClaim(pool, reader, unavailable, verifierClient, releaseClient, claimId),
  ).rejects.toThrow("Lost provider response");
  await advanceTime(301);
  expect(
    await processClaim(pool, reader, unavailable, verifierClient, releaseClient, claimId),
  ).toEqual({ state: "ADMISSION_EXPIRED" });
  await processClaim(pool, reader, unavailable, verifierClient, releaseClient, claimId);
  expect(sends).toBe(1);
  expect((await reader.read(policy)).state).toBe(1);
  expect(
    (await pool.query("select job_state from claims where claim_id=$1", [claimId])).rows[0]
      .job_state,
  ).toBe("ADMISSION_EXPIRED");
  expect(
    (await pool.query("select count(*) from reports where claim_id=$1", [claimId])).rows[0].count,
  ).toBe("0");
});
it("Settles both nonqualifying controls and keeps organization report access locked", async () => {
  for (const item of [cases.fixtures[1], cases.fixtures[2]]) {
    const claimId = await upload(item.fixture);
    expect(
      await processClaim(pool, reader, relayer, verifierClient, releaseClient, claimId),
    ).toEqual({ state: "SETTLED" });
    expect((await reader.read(policy)).state).toBe(1);
    const report = (await pool.query("select id from reports where claim_id=$1", [claimId]))
      .rows[0];
    const own = await researcher.inject({
      url: `/private/researcher/reports/${report.id}`,
      headers: headers(),
    });
    expect(own.statusCode).toBe(200);
    expect(own.json().outcome).toBe("DOES_NOT_QUALIFY");
    expect(
      (
        await organization.inject({
          url: `/private/organization/reports/${report.id}`,
          headers: headers(),
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await researcher.inject({
          url: `/private/researcher/reports/${report.id}`,
          headers: headers(0),
        })
      ).statusCode,
    ).toBe(404);
  }
}, 20000);
it("Pays the qualifying claim once and releases the exact report after final payment", async () => {
  const claimId = await upload(cases.fixtures[0].fixture);
  const before = await publicClient.readContract({
    address: asset,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [accounts[1].address],
  });
  // Simulate report service downtime after payment. A retry must not pay twice.
  const unavailable = {
    post: async <T>(): Promise<T> => {
      throw new Error("Report service unavailable");
    },
  };
  await expect(
    processClaim(pool, reader, relayer, verifierClient, unavailable, claimId),
  ).rejects.toThrow("Report service unavailable");
  expect((await reader.read(policy)).state).toBe(4);
  const count = calls.size;
  await processClaim(pool, reader, relayer, verifierClient, releaseClient, claimId);
  await processClaim(pool, reader, relayer, verifierClient, releaseClient, claimId);
  expect(calls.size).toBe(count);
  const savedIntent = (
    await pool.query(
      "select id from transaction_intents where request_json->>'claimId'=$1 limit 1",
      [claimId],
    )
  ).rows[0];
  expect(savedIntent).toBeDefined();
  await expect(
    pool.query("update transaction_intents set id=gen_random_uuid() where id=$1", [savedIntent.id]),
  ).rejects.toThrow("Circle request identity is immutable");
  const after = await publicClient.readContract({
    address: asset,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [accounts[1].address],
  });
  expect(after - before).toBe(1000000n);
  const report = (
    await pool.query("select id,report_hash from reports where claim_id=$1", [claimId])
  ).rows[0];
  const response = await organization.inject({
    url: `/private/organization/reports/${report.id}`,
    headers: headers(0),
  });
  expect(response.statusCode).toBe(200);
  expect(response.headers["cache-control"]).toBe("no-store");
  expect(keccak256(toHex(response.body))).toBe(report.report_hash);
  expect(response.json().outcome).toBe("QUALIFIES");
  expect(
    (
      await organization.inject({
        url: `/private/organization/reports/${report.id}`,
        headers: headers(2),
      })
    ).statusCode,
  ).toBe(404);
  await pool.query(
    "update memberships set status='REVOKED' where organization_id=$1 and user_id=$2",
    [orgId, ids[1]],
  );
  expect(
    (
      await organization.inject({
        url: `/private/organization/reports/${report.id}`,
        headers: headers(),
      })
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await researcher.inject({
        url: `/private/researcher/reports/${report.id}`,
        headers: headers(),
      })
    ).statusCode,
  ).toBe(200);
}, 20000);

it("Reconciles an external payment after a lost assessment response", async () => {
  await fundNext();
  const claimId = await upload(cases.fixtures[0].fixture);
  let externalHash: Hex | undefined;
  const concurrent: ClaimRelayer = {
    walletId: relayer.walletId,
    send: async (key, escrow, call, requestId) => {
      const result = await relayer.send(key, escrow, call, requestId);
      if (call.method === "submitAssessment" && !externalHash) {
        externalHash = await collectExternally();
        throw new Error("Lost assessment response after external payment");
      }
      return result;
    },
  };
  await expect(
    processClaim(pool, reader, concurrent, verifierClient, releaseClient, claimId),
  ).rejects.toThrow("Lost assessment response");
  const sent = calls.size;
  await processClaim(pool, reader, concurrent, verifierClient, releaseClient, claimId);
  expect(calls.size).toBe(sent);
  expect(calls.has(`${claimId}:collectPayment`)).toBe(false);
  expect(
    (await pool.query("select state from reports where claim_id=$1", [claimId])).rows[0].state,
  ).toBe("AVAILABLE");
  const payment = (
    await pool.query(
      "select transaction_hash from chain_events where name='Paid' and payload_json->>'claimId'=$1",
      [claimId],
    )
  ).rows[0];
  expect(payment.transaction_hash).toBe(externalHash);
  const qualified = (
    await pool.query(
      "select block_number from chain_events where name='ClaimQualified' and payload_json->>'claimId'=$1",
      [claimId],
    )
  ).rows[0];
  await expect(
    reader.findPaid(policy, h(999), BigInt(qualified.block_number)),
  ).rejects.toMatchObject({ code: "PAYMENT_NOT_INDEXED" });
}, 20000);
