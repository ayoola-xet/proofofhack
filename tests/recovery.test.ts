import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { PgBoss } from "pg-boss";
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
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { bountyEscrowAbi } from "../packages/chain/src/abi/BountyEscrow.ts";
import { ReadOnlyBountyChain } from "../packages/chain/src/bounty-reader.ts";
import type { FundingReceipt } from "../packages/chain/src/funding.ts";
import { contractPolicy } from "../packages/chain/src/policy.ts";
import {
  type RecoveryChain,
  type RecoveryScanner,
  recoveryEvents,
} from "../packages/chain/src/recovery.ts";
import { connectDatabase, databaseUrl } from "../packages/database/src/index.ts";
import {
  ADAPTER_ID,
  admissionFields,
  assessmentFields,
  hashPolicy,
  signingDomain,
} from "../packages/domain/src/index.ts";
import { createApp } from "../services/api/src/app.ts";
import { LocalAuthProvider } from "../services/api/src/auth.ts";
import { reportAccess } from "../services/report-release/src/access.ts";
import { processClaim } from "../services/worker/src/claim-process.ts";
import { startRecoveryJobs } from "../services/worker/src/recovery-jobs.ts";
import { processRecovery, type RecoveryRelayer } from "../services/worker/src/recovery-process.ts";
import { reconcileRecovery } from "../services/worker/src/recovery-receipt.ts";
import { a, examplePolicy, h } from "./helpers/policy.ts";

const admin = connectDatabase().pool;
const name = `recovery_test_${randomUUID().replaceAll("-", "")}`;
const url = new URL(databaseUrl());
url.pathname = `/${name}`;
const { pool, db } = connectDatabase(url.toString());
const account = privateKeyToAccount(generatePrivateKey());
const users = [0, 1, 2, 3].map((i) => ({
  id: randomUUID(),
  token: randomUUID(),
  subject: `local:recovery:${randomUUID()}`,
  displayName: `Recovery actor ${i}`,
}));
const org = randomUUID(),
  program = randomUUID(),
  claimantWallet = randomUUID();
const serviceWallet = randomUUID();
let anvil: ChildProcess | undefined;
let rpc: string, asset: Hex, escrow: Hex, reader: ReadOnlyBountyChain;
let wallet: ReturnType<typeof createWalletClient>, client: ReturnType<typeof createPublicClient>;
let api: Awaited<ReturnType<typeof createApp>>;
const headers = (i = 0) => ({
  authorization: `Bearer ${users[i].token}`,
  "idempotency-key": randomUUID(),
});
async function control(method: string, params: unknown[]) {
  const result = await (
    await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    })
  ).json();
  if (result.error) throw new Error("Local chain control failed.");
}
const finalize = () => control("anvil_mine", ["0x41"]);
async function send(method: "expireReservation" | "refundExpired", bounty: Hex) {
  const hash = await wallet.writeContract({
    account,
    chain: wallet.chain,
    address: escrow,
    abi: bountyEscrowAbi,
    functionName: method,
    args: [bounty],
  });
  await client.waitForTransactionReceipt({ hash });
  await finalize();
  return hash;
}
async function reconcile(bounty: Hex, hash: Hex, chain: RecoveryChain = reader) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    const result = await reconcileRecovery(c, chain, bounty, hash);
    await c.query("commit");
    return result;
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}
beforeAll(async () => {
  await admin.query(`create database ${name}`);
  await migrate(db, { migrationsFolder: "packages/database/migrations" });
  const port = await new Promise<number>((resolve, reject) => {
    const s = createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const address = s.address();
      if (!address || typeof address === "string") return reject(new Error("No port"));
      s.close(() => resolve(address.port));
    });
  });
  rpc = `http://127.0.0.1:${port}`;
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
  client = createPublicClient({
    pollingInterval: 50,
    transport: http(rpc, { retryCount: 0, timeout: 1000 }),
  });
  for (let i = 0; i < 50; i++) {
    try {
      await client.getChainId();
      break;
    } catch (e) {
      if (i === 49) throw e;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const chain = defineChain({
    id: 31337,
    name: "Local recovery test",
    nativeCurrency: { name: "Test ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  });
  wallet = createWalletClient({ account, chain, transport: http(rpc) });
  await control("anvil_setBalance", [account.address, toHex(10n ** 21n)]);
  const token = JSON.parse(await readFile("contracts/out/TestUSDC.sol/TestUSDC.json", "utf8"));
  const contract = JSON.parse(
    await readFile("contracts/out/BountyEscrow.sol/BountyEscrow.json", "utf8"),
  );
  asset = (
    await client.waitForTransactionReceipt({
      hash: await wallet.deployContract({
        account,
        chain,
        abi: token.abi,
        bytecode: token.bytecode.object,
      }),
    })
  ).contractAddress?.toLowerCase() as Hex;
  escrow = (
    await client.waitForTransactionReceipt({
      hash: await wallet.deployContract({
        account,
        chain,
        abi: bountyEscrowAbi,
        bytecode: contract.bytecode.object,
        args: [asset],
      }),
    })
  ).contractAddress?.toLowerCase() as Hex;
  reader = new ReadOnlyBountyChain(rpc, 31337, escrow);
  await pool.query(
    "insert into wallets(id,provider,provider_wallet_id,owner_type,owner_id,chain_id,address) values($1::uuid,'CIRCLE',$1::text,'SERVICE',$1,'31337',$2)",
    [serviceWallet, account.address.toLowerCase()],
  );
  for (const u of users)
    await pool.query("insert into users(id,privy_user_id,display_name) values($1,$2,$3)", [
      u.id,
      u.subject,
      u.displayName,
    ]);
  await pool.query(
    "insert into organizations(id,onchain_id,name,owner_user_id) values($1,$2,'Recovery test',$3)",
    [org, h(22), users[0].id],
  );
  for (const [i, role] of [
    [0, "OWNER"],
    [1, "TREASURY"],
    [2, "REVIEWER"],
  ] as const)
    await pool.query("insert into memberships(organization_id,user_id,role) values($1,$2,$3)", [
      org,
      users[i].id,
      role,
    ]);
  await pool.query("insert into programs(id,organization_id,name) values($1,$2,'Recovery test')", [
    program,
    org,
  ]);
  await pool.query(
    "insert into wallets(id,provider,provider_wallet_id,owner_type,owner_id,chain_id,address) values($1,'LOCAL','recovery-claimant','USER',$2,'31337',$3)",
    [claimantWallet, users[3].id, a(19)],
  );
  api = await createApp({
    pool,
    auth: new LocalAuthProvider(users, "local"),
    appEnv: "local",
    webOrigin: "http://localhost:5173",
    recoveryChain: reader,
  });
}, 30000);
afterAll(async () => {
  await api?.close();
  anvil?.kill("SIGTERM");
  await pool.end();
  await admin.query(`drop database if exists ${name}`);
  await admin.end();
});

async function fixture(reserve = true) {
  const now = (await client.getBlock()).timestamp;
  const policy = {
    ...examplePolicy(),
    escrow,
    asset,
    admissionSigner: account.address.toLowerCase() as Hex,
    verdictSigner: account.address.toLowerCase() as Hex,
    organizationId: h(22),
    refundRecipient: account.address.toLowerCase() as Hex,
    reward: "1000000",
    organizationNonce: keccak256(toHex(randomUUID())),
    submissionDeadline: String(now + 10000n),
    settlementDeadline: String(now + 12000n),
    reservationDurationSeconds: "60",
  };
  const bounty = hashPolicy(policy),
    claim = keccak256(toHex(randomUUID())),
    upload = randomUUID(),
    report = randomUUID();
  await client.waitForTransactionReceipt({
    hash: await wallet.writeContract({
      account,
      chain: wallet.chain,
      address: asset,
      abi: erc20Abi,
      functionName: "approve",
      args: [escrow, 1000000n],
    }),
  });
  const funded = await client.waitForTransactionReceipt({
    hash: await wallet.writeContract({
      account,
      chain: wallet.chain,
      address: escrow,
      abi: bountyEscrowAbi,
      functionName: "createAndFund",
      args: [contractPolicy(policy)],
    }),
  });
  await pool.query(
    "insert into bounties(bounty_id,program_id,policy_hash,policy_json,chain_id,escrow,reward,unallocated_reward,chain_state,creation_tx) values($1,$2,$1,$3,'31337',$4,'1000000','1000000','FUNDED',$5)",
    [bounty, program, JSON.stringify(policy), escrow, funded.transactionHash],
  );
  if (reserve) {
    const admission = {
      bountyId: bounty,
      claimId: claim,
      claimant: a(19),
      evidenceCommitment: h(21),
      authorizationNonce: keccak256(toHex(randomUUID())),
      validUntil: now + 600n,
    };
    const signature = await account.signTypedData({
      domain: signingDomain(31337, escrow),
      types: { AdmissionV1: admissionFields },
      primaryType: "AdmissionV1",
      message: admission,
    });
    await client.waitForTransactionReceipt({
      hash: await wallet.writeContract({
        account,
        chain: wallet.chain,
        address: escrow,
        abi: bountyEscrowAbi,
        functionName: "reserveClaim",
        args: [admission, signature],
      }),
    });
    await pool.query(
      "insert into uploads(id,owner_user_id,bounty_id,object_key,ciphertext_hash,key_id,byte_length,state,expires_at,delete_after) values($1::uuid,$2,$3,$1::text,$4,'fixture',5,'UPLOADED',now()+interval '1 day',null)",
      [upload, users[3].id, bounty, h(21)],
    );
    await pool.query(
      "insert into claims(claim_id,bounty_id,researcher_user_id,claimant_wallet_id,claimant_address,upload_id,evidence_commitment,job_state) values($1,$2,$3,$4,$5,$6,$7,'ASSESSED')",
      [claim, bounty, users[3].id, claimantWallet, a(19), upload, h(21)],
    );
    await pool.query(
      "insert into reports(id,claim_id,report_hash,ciphertext_object_key,wrapped_key_ref,recipient_key_id,state,delete_after,retention_hold) values($1,$2,$3,$4,'fixture',$5,'SEALED',now()-interval '1 day',true)",
      [report, claim, h(25), randomUUID(), policy.reportRecipientKeyId],
    );
    await pool.query("update bounties set chain_state='RESERVED' where bounty_id=$1", [bounty]);
  }
  await finalize();
  return { policy, bounty, claim, report };
}

it("Records final expiry, releases only its report hold, and preserves the deletion date on replay", async () => {
  const f = await fixture();
  await control("evm_increaseTime", [100]);
  const hash = await send("expireReservation", f.bounty);
  const result = await reconcile(f.bounty, hash);
  expect(result.events.map((e) => e.name)).toEqual(["ReservationExpired"]);
  const before = (await pool.query("select * from reports where id=$1", [f.report])).rows[0];
  expect(before).toMatchObject({
    retention_hold: false,
    state: "SEALED",
    expiry_event_ref: result.events[0].id,
  });
  expect(before.delete_after.getTime() - Date.now()).toBeGreaterThan(6.9 * 86400000);
  expect(
    (await pool.query("select job_state from claims where claim_id=$1", [f.claim])).rows[0]
      .job_state,
  ).toBe("EXPIRED");
  expect(
    (await pool.query("select chain_state from bounties where bounty_id=$1", [f.bounty])).rows[0]
      .chain_state,
  ).toBe("FUNDED");
  await expect(reportAccess(pool, users[0].id, f.report, "organization")).rejects.toMatchObject({
    code: "REPORT_LOCKED",
  });
  expect((await reportAccess(pool, users[3].id, f.report, "researcher")).id).toBe(f.report);
  await reconcile(f.bounty, hash);
  const after = (await pool.query("select * from reports where id=$1", [f.report])).rows[0];
  expect(after.delete_after).toEqual(before.delete_after);
  expect(after.version).toEqual(before.version);
  await expect(
    pool.query("update reports set delete_after=now()+interval '30 days' where id=$1", [f.report]),
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    pool.query("update reports set expiry_event_ref=null,retention_hold=true where id=$1", [
      f.report,
    ]),
  ).rejects.toMatchObject({ code: "23514" });
}, 15000);

it("Records a combined expiry and refund once with the fixed token transfer", async () => {
  const f = await fixture();
  const balance = await client.readContract({
    address: asset,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account.address],
  });
  await control("evm_setNextBlockTimestamp", [Number(f.policy.settlementDeadline) + 1]);
  const hash = await send("refundExpired", f.bounty);
  expect(
    await client.readContract({
      address: asset,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account.address],
    }),
  ).toBe(balance + 1000000n);
  const [one, two] = await Promise.all([
    reconcile(f.bounty, hash),
    reconcile(f.bounty, hash).catch((e) => e),
  ]);
  expect(one.events.map((e) => e.name)).toEqual(["ReservationExpired", "BountyRefunded"]);
  if (two instanceof Error) expect(two).toMatchObject({ code: "RECOVERY_BUSY" });
  await reconcile(f.bounty, hash);
  const receipts = (await pool.query("select * from receipts where bounty_id=$1", [f.bounty])).rows;
  expect(receipts).toHaveLength(1);
  expect(receipts[0]).toMatchObject({
    category: "REFUND",
    amount: f.policy.reward,
    asset,
    status: "FINAL",
    claimant_user_id: null,
  });
  expect(
    (
      await pool.query(
        "select chain_state,unallocated_reward,claimant_credit from bounties where bounty_id=$1",
        [f.bounty],
      )
    ).rows[0],
  ).toEqual({ chain_state: "REFUNDED", unallocated_reward: "0", claimant_credit: "0" });
  expect(
    (await pool.query("select retention_hold from reports where id=$1", [f.report])).rows[0]
      .retention_hold,
  ).toBe(false);
}, 15000);

it("Allows current owners and treasury members, rejects other roles, and checks membership on retry", async () => {
  const f = await fixture(false);
  await control("evm_setNextBlockTimestamp", [Number(f.policy.settlementDeadline) + 1]);
  const hash = await send("refundExpired", f.bounty);
  const request = {
    method: "POST" as const,
    url: `/api/v1/bounties/${f.bounty}/recovery-receipts`,
    payload: { transactionHash: hash },
  };
  expect((await api.inject({ ...request, headers: headers(2) })).statusCode).toBe(403);
  expect((await api.inject({ ...request, headers: headers(3) })).statusCode).toBe(404);
  expect(
    (await pool.query("select id from receipts where bounty_id=$1", [f.bounty])).rows,
  ).toHaveLength(0);
  const authHeaders = headers(1);
  const result = await api.inject({ ...request, headers: authHeaders });
  expect(result.statusCode, result.body).toBe(200);
  expect((await api.inject({ ...request, headers: authHeaders })).json()).toEqual(result.json());
  expect((await api.inject({ ...request, headers: headers(0) })).statusCode).toBe(200);
  await pool.query(
    "update memberships set status='REMOVED' where organization_id=$1 and user_id=$2",
    [org, users[1].id],
  );
  expect((await api.inject({ ...request, headers: authHeaders })).statusCode).toBe(404);
  await pool.query(
    "update memberships set status='ACTIVE' where organization_id=$1 and user_id=$2",
    [org, users[1].id],
  );
}, 15000);

it("Rejects missing finality, wrong scope, changed transfer details, and saved event conflicts without mutation", async () => {
  const f = await fixture();
  await control("evm_setNextBlockTimestamp", [Number(f.policy.settlementDeadline) + 1]);
  const hash = await send("refundExpired", f.bounty);
  const receipt = (await reader.finalReceipt(hash)) as FundingReceipt;
  const stub = (r: FundingReceipt | null): RecoveryChain => ({
    read: (p) => reader.read(p),
    finalReceipt: async () => r,
  });
  await expect(reconcile(f.bounty, hash, stub(null))).rejects.toMatchObject({
    code: "RECOVERY_NOT_FINAL",
  });
  await expect(
    reconcile(f.bounty, hash, stub({ ...receipt, status: "reverted" })),
  ).rejects.toMatchObject({ code: "RECOVERY_EVENT_MISMATCH" });
  await expect(reconcile(f.bounty, hash, stub({ ...receipt, hash: h(91) }))).rejects.toMatchObject({
    code: "RECOVERY_EVENT_MISMATCH",
  });
  expect(() => recoveryEvents(receipt, { ...f.policy, refundRecipient: a(66) })).toThrow();
  const transfer = receipt.logs.find((l) => l.address.toLowerCase() === asset);
  expect(transfer).toBeDefined();
  for (const change of [
    { address: a(80) },
    { data: toHex(999n, { size: 32 }) },
    { topics: [transfer?.topics[0], h(1), h(2)] },
    { removed: true },
    { blockHash: h(19) },
    { transactionHash: h(55) },
  ]) {
    const bad = {
      ...receipt,
      logs: receipt.logs.map((l) => (l === transfer ? { ...l, ...change } : l)),
    } as FundingReceipt;
    await expect(reconcile(f.bounty, hash, stub(bad))).rejects.toMatchObject({
      code: "RECOVERY_EVENT_MISMATCH",
    });
  }
  expect(
    (await pool.query("select retention_hold from reports where id=$1", [f.report])).rows[0]
      .retention_hold,
  ).toBe(true);
  expect(
    (await pool.query("select id from chain_events where transaction_hash=$1", [hash])).rows,
  ).toHaveLength(0);
  const log = recoveryEvents(receipt, f.policy)[0];
  await pool.query(
    "insert into chain_events(chain_id,contract_address,transaction_hash,log_index,block_number,block_hash,name,payload_json,finality_state) values('31337',$1,$2,$3,$4,$5,'ReservationExpired',$6,'FINAL')",
    [escrow, hash, log.logIndex, String(receipt.blockNumber), h(90), JSON.stringify(log.args)],
  );
  await expect(reconcile(f.bounty, hash)).rejects.toMatchObject({
    code: "RECOVERY_EVENT_CONFLICT",
  });
  expect(
    (await pool.query("select id from receipts where bounty_id=$1", [f.bounty])).rows,
  ).toHaveLength(0);
}, 15000);

it("Does not clear a report hold with another claim's event", async () => {
  const f = await fixture();
  const event = randomUUID();
  await pool.query(
    "insert into chain_events(id,chain_id,contract_address,transaction_hash,log_index,block_number,block_hash,name,payload_json,finality_state) values($1,'31337',$2,$3,0,10,$4,'ReservationExpired',$5,'FINAL')",
    [event, escrow, h(93), h(94), JSON.stringify({ bountyId: f.bounty, claimId: h(99) })],
  );
  await expect(
    pool.query("update reports set retention_hold=false,expiry_event_ref=$2 where id=$1", [
      f.report,
      event,
    ]),
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    pool.query("update reports set retention_hold=false where id=$1", [f.report]),
  ).rejects.toMatchObject({ code: "23514" });
}, 15000);

it("Does not replace a later refund when an older expiry arrives", async () => {
  const f = await fixture();
  await control("evm_increaseTime", [100]);
  const expired = await send("expireReservation", f.bounty);
  await control("evm_setNextBlockTimestamp", [Number(f.policy.settlementDeadline) + 1]);
  const refunded = await send("refundExpired", f.bounty);
  await reconcile(f.bounty, refunded);
  const before = (
    await pool.query("select chain_state,last_event_key,version from bounties where bounty_id=$1", [
      f.bounty,
    ])
  ).rows[0];
  expect(
    (await pool.query("select retention_hold from reports where id=$1", [f.report])).rows[0]
      .retention_hold,
  ).toBe(true);
  await reconcile(f.bounty, expired);
  expect(
    (
      await pool.query(
        "select chain_state,last_event_key,version from bounties where bounty_id=$1",
        [f.bounty],
      )
    ).rows[0],
  ).toEqual(before);
  expect(
    (await pool.query("select retention_hold from reports where id=$1", [f.report])).rows[0]
      .retention_hold,
  ).toBe(false);
}, 15000);

it("Defers recovery during claim processing and waits for an active assessment", async () => {
  const f = await fixture();
  await control("evm_increaseTime", [100]);
  const hash = await send("expireReservation", f.bounty);
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
      `claim-lifecycle:${f.bounty}`,
    ]);
    await expect(reconcile(f.bounty, hash)).rejects.toMatchObject({ code: "RECOVERY_BUSY" });
    await c.query("rollback");
    await c.query("begin");
    await c.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`verifier:${f.claim}`]);
    let complete = false;
    const pending = reconcile(f.bounty, hash).then((result) => {
      complete = true;
      return result;
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(complete).toBe(false);
      expect(
        (await c.query("select retention_hold from reports where id=$1", [f.report])).rows[0]
          .retention_hold,
      ).toBe(true);
    } finally {
      await c.query("commit");
      await pending;
    }
    expect(
      (await c.query("select retention_hold from reports where id=$1", [f.report])).rows[0]
        .retention_hold,
    ).toBe(false);
  } finally {
    await c.query("rollback");
    c.release();
  }
}, 15000);

function localRelayer() {
  const sent = new Map<string, Hex>();
  let loseAfterSend = false,
    failBeforeSend = false;
  const relayer: RecoveryRelayer = {
    walletId: serviceWallet,
    sendRecovery: vi.fn(async (key, _escrow, call) => {
      if (failBeforeSend) {
        failBeforeSend = false;
        throw new Error("Provider unavailable");
      }
      let hash = sent.get(key);
      if (!hash) {
        hash = await send(call.method, call.bountyId);
        sent.set(key, hash);
      }
      if (loseAfterSend) {
        loseAfterSend = false;
        throw new Error("Lost response");
      }
      return { hash, providerId: key };
    }),
  };
  return {
    relayer,
    sent,
    lose: () => {
      loseAfterSend = true;
    },
    fail: () => {
      failBeforeSend = true;
    },
  };
}
function scanner(overrides: Partial<RecoveryScanner>): RecoveryScanner {
  return {
    read: (p) => reader.read(p),
    finalReceipt: (h) => reader.finalReceipt(h),
    blockHash: (b) => reader.blockHash(b),
    recoveryRange: (p, f, t) => reader.recoveryRange(p, f, t),
    ...overrides,
  };
}
it("Automatically expires a reservation and refunds its remaining reward once", async () => {
  const f = await fixture(),
    relay = localRelayer();
  expect((await processRecovery(pool, reader, relay.relayer, f.bounty)).status).toBe("WAITING");
  expect(relay.relayer.sendRecovery).not.toHaveBeenCalled();
  await control("evm_increaseTime", [100]);
  await finalize();
  await processRecovery(pool, reader, relay.relayer, f.bounty);
  expect(
    (await pool.query("select job_state from claims where claim_id=$1", [f.claim])).rows[0]
      .job_state,
  ).toBe("EXPIRED");
  expect(
    (await pool.query("select retention_hold from reports where id=$1", [f.report])).rows[0]
      .retention_hold,
  ).toBe(false);
  await processRecovery(pool, reader, relay.relayer, f.bounty);
  expect(relay.sent.size).toBe(1);
  await control("evm_setNextBlockTimestamp", [Number(f.policy.settlementDeadline) + 1]);
  await finalize();
  await processRecovery(pool, reader, relay.relayer, f.bounty);
  expect((await processRecovery(pool, reader, relay.relayer, f.bounty)).status).toBe("COMPLETE");
  expect(relay.sent.size).toBe(2);
  const rows = (
    await pool.query("select * from transaction_intents where request_json->>'bountyId'=$1", [
      f.bounty,
    ])
  ).rows;
  expect(rows).toHaveLength(2);
  expect(rows.every((r) => r.state === "CONFIRMED")).toBe(true);
  expect(
    (await pool.query("select amount,category from receipts where bounty_id=$1", [f.bounty])).rows,
  ).toEqual([{ amount: f.policy.reward, category: "REFUND" }]);
  await expect(
    pool.query("update transaction_intents set request_json='{}' where id=$1", [rows[0].id]),
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    pool.query("update transaction_intents set transaction_hash=$2 where id=$1", [
      rows[0].id,
      h(234),
    ]),
  ).rejects.toMatchObject({ code: "23514" });
}, 15000);

it("Discovers an accepted request after a lost response without sending it again", async () => {
  const f = await fixture(),
    relay = localRelayer();
  await control("evm_increaseTime", [100]);
  await finalize();
  relay.lose();
  expect((await processRecovery(pool, reader, relay.relayer, f.bounty)).status).toBe("RETRYING");
  const before = (
    await pool.query("select * from transaction_intents where request_json->>'bountyId'=$1", [
      f.bounty,
    ])
  ).rows[0];
  expect(before).toMatchObject({ state: "SUBMITTED", transaction_hash: null });
  expect((await processRecovery(pool, reader, relay.relayer, f.bounty)).status).toBe("WAITING");
  expect(relay.relayer.sendRecovery).toHaveBeenCalledTimes(1);
  expect(
    (await pool.query("select state from transaction_intents where id=$1", [before.id])).rows[0]
      .state,
  ).toBe("RECONCILED");
  expect(
    (await pool.query("select job_state from claims where claim_id=$1", [f.claim])).rows[0]
      .job_state,
  ).toBe("EXPIRED");
}, 15000);

it("Retries an unresolved request with the same provider key and does not resend a known pending hash", async () => {
  const f = await fixture(),
    relay = localRelayer();
  await control("evm_increaseTime", [100]);
  await finalize();
  relay.fail();
  await processRecovery(pool, reader, relay.relayer, f.bounty);
  const before = (
    await pool.query("select * from transaction_intents where request_json->>'bountyId'=$1", [
      f.bounty,
    ])
  ).rows[0];
  let hide = true;
  const chain = scanner({
    finalReceipt: async (hash) =>
      hide && [...relay.sent.values()].includes(hash) ? null : reader.finalReceipt(hash),
  });
  expect((await processRecovery(pool, chain, relay.relayer, f.bounty)).status).toBe("CONFIRMING");
  await processRecovery(pool, chain, relay.relayer, f.bounty);
  expect(relay.relayer.sendRecovery).toHaveBeenCalledTimes(2);
  const calls = vi.mocked(relay.relayer.sendRecovery).mock.calls;
  expect(calls[0]).toEqual(calls[1]);
  expect(
    (
      await pool.query(
        "select count(*) from transaction_intents where request_json->>'bountyId'=$1",
        [f.bounty],
      )
    ).rows[0].count,
  ).toBe("1");
  hide = false;
  await processRecovery(pool, chain, relay.relayer, f.bounty);
  expect(
    (await pool.query("select state from transaction_intents where id=$1", [before.id])).rows[0]
      .state,
  ).toBe("CONFIRMED");
}, 15000);

it("Logs a failed recovery step without the provider's private error contents", async () => {
  const f = await fixture(false),
    relay = localRelayer(),
    marker = `private-provider-request-${randomUUID()}`;
  const chain = scanner({
    read: async () => {
      throw new Error(marker);
    },
  });
  const log = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  try {
    expect(await processRecovery(pool, chain, relay.relayer, f.bounty)).toMatchObject({
      status: "RETRYING",
      code: "RECOVERY_PROVIDER_UNAVAILABLE",
    });
    const output = log.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(output).toContain('"stage":"read-chain-state"');
    expect(output).not.toContain(marker);
    expect(output).not.toContain("stack");
    expect(relay.relayer.sendRecovery).not.toHaveBeenCalled();
  } finally {
    log.mockRestore();
  }
});

it("Scans a refund sent outside the app and finishes only after its receipt is recorded", async () => {
  const f = await fixture(),
    relay = localRelayer();
  await control("evm_setNextBlockTimestamp", [Number(f.policy.settlementDeadline) + 1]);
  await send("refundExpired", f.bounty);
  expect((await processRecovery(pool, reader, relay.relayer, f.bounty)).status).toBe("COMPLETE");
  expect(relay.relayer.sendRecovery).not.toHaveBeenCalled();
  expect(
    (await pool.query("select category from receipts where bounty_id=$1", [f.bounty])).rows,
  ).toEqual([{ category: "REFUND" }]);
  expect(
    (await pool.query("select retention_hold from reports where id=$1", [f.report])).rows[0]
      .retention_hold,
  ).toBe(false);
}, 15000);

it("Does not skip a refund finalized after the scanner's first head read", async () => {
  const f = await fixture(false),
    relay = localRelayer();
  let reads = 0;
  const chain = scanner({
    read: async (p) => {
      reads++;
      if (reads === 2) {
        await control("evm_setNextBlockTimestamp", [Number(f.policy.settlementDeadline) + 1]);
        await send("refundExpired", f.bounty);
      }
      return reader.read(p);
    },
  });
  expect((await processRecovery(pool, chain, relay.relayer, f.bounty)).status).toBe("SCANNING");
  expect(
    (await pool.query("select category from receipts where bounty_id=$1", [f.bounty])).rows,
  ).toHaveLength(0);
  expect((await processRecovery(pool, reader, relay.relayer, f.bounty)).status).toBe("COMPLETE");
  expect(
    (await pool.query("select category from receipts where bounty_id=$1", [f.bounty])).rows,
  ).toHaveLength(1);
  expect(relay.relayer.sendRecovery).not.toHaveBeenCalled();
}, 15000);

it("Resumes bounded pages after a restart and rejects a changed final checkpoint", async () => {
  const f = await fixture(false),
    relay = localRelayer();
  await processRecovery(pool, reader, relay.relayer, f.bounty);
  const previous = (
    await pool.query("select checkpoint_block from bounty_recovery where bounty_id=$1", [f.bounty])
  ).rows[0].checkpoint_block;
  await control("anvil_mine", ["0x64"]);
  const ranges: bigint[][] = [];
  const chain = scanner({
    recoveryRange: async (p, from, to) => {
      ranges.push([from, to]);
      return reader.recoveryRange(p, from, to);
    },
  });
  expect(
    (await processRecovery(pool, chain, relay.relayer, f.bounty, { blocks: 20n, pages: 2 })).status,
  ).toBe("SCANNING");
  expect(ranges).toHaveLength(2);
  expect(ranges[0][0]).toBe(BigInt(previous) + 1n);
  expect(ranges.every(([from, to]) => to - from < 20n)).toBe(true);
  const checkpoint = (
    await pool.query("select checkpoint_block from bounty_recovery where bounty_id=$1", [f.bounty])
  ).rows[0].checkpoint_block;
  ranges.length = 0;
  await processRecovery(pool, chain, relay.relayer, f.bounty, { blocks: 20n, pages: 2 });
  expect(ranges[0][0]).toBe(BigInt(checkpoint) + 1n);
  expect(
    await processRecovery(
      pool,
      scanner({ blockHash: async () => h(999) }),
      relay.relayer,
      f.bounty,
    ),
  ).toEqual({ status: "NEEDS_REVIEW", code: "RECOVERY_CHECKPOINT_CHANGED" });
}, 15000);

it("Preserves an old unknown request for review instead of assigning another provider key", async () => {
  const f = await fixture(),
    relay = localRelayer();
  await control("evm_increaseTime", [100]);
  await finalize();
  relay.fail();
  await processRecovery(pool, reader, relay.relayer, f.bounty);
  const current = Date.now(),
    clock = vi.spyOn(Date, "now").mockReturnValue(current + 24 * 3600000);
  try {
    expect(await processRecovery(pool, reader, relay.relayer, f.bounty)).toEqual({
      status: "NEEDS_REVIEW",
      code: "RECONCILIATION_REQUIRED",
    });
  } finally {
    clock.mockRestore();
  }
  expect(relay.relayer.sendRecovery).toHaveBeenCalledTimes(1);
  const request = {
    method: "POST" as const,
    url: `/api/v1/bounties/${f.bounty}/recovery/retry`,
    headers: headers(),
    payload: {},
  };
  expect((await api.inject(request)).statusCode).toBe(202);
  expect((await api.inject(request)).statusCode).toBe(202);
  expect(
    (
      await pool.query(
        "select count(*) from outbox where aggregate_id=$1 and event_type='RECOVERY_PROCESS'",
        [f.bounty],
      )
    ).rows[0].count,
  ).toBe("1");
  expect(
    (
      await pool.query("select active_intent_id from bounty_recovery where bounty_id=$1", [
        f.bounty,
      ])
    ).rows[0].active_intent_id,
  ).not.toBeNull();
  expect((await api.inject({ ...request, headers: headers(2) })).statusCode).toBe(403);
  expect(
    (await api.inject({ url: `/api/v1/organizations/${org}/recovery`, headers: headers(0) }))
      .statusCode,
  ).toBe(200);
  expect(
    (await api.inject({ url: `/api/v1/organizations/${org}/recovery`, headers: headers(3) }))
      .statusCode,
  ).toBe(404);
}, 15000);

it("Preserves qualified claimant credit after the settlement deadline", async () => {
  const f = await fixture(),
    relay = localRelayer(),
    state = await reader.read(f.policy);
  const assessment = {
    bountyId: f.bounty,
    policyHash: f.bounty,
    claimId: f.claim,
    claimant: a(19),
    evidenceCommitment: h(21),
    caseNullifier: h(260),
    reportHash: h(25),
    adapterCodeHash: f.policy.adapterCodeHash,
    verifierConfigHash: f.policy.verifierConfigHash,
    outcome: 1,
    reward: BigInt(f.policy.reward),
    assessedAt: state.timestamp,
    validUntil: state.reservation.expiresAt,
  };
  const signature = await account.signTypedData({
    domain: signingDomain(31337, escrow),
    types: { AssessmentV1: assessmentFields },
    primaryType: "AssessmentV1",
    message: assessment,
  });
  await client.waitForTransactionReceipt({
    hash: await wallet.writeContract({
      account,
      chain: wallet.chain,
      address: escrow,
      abi: bountyEscrowAbi,
      functionName: "submitAssessment",
      args: [assessment, signature],
    }),
  });
  await control("evm_setNextBlockTimestamp", [Number(f.policy.settlementDeadline) + 1]);
  await finalize();
  expect((await processRecovery(pool, reader, relay.relayer, f.bounty)).status).toBe("COMPLETE");
  expect(relay.relayer.sendRecovery).not.toHaveBeenCalled();
  const after = await reader.read(f.policy);
  expect(after.state).toBe(3);
  expect(after.claimantCredit).toBe(BigInt(f.policy.reward));
  expect(
    (await pool.query("select retention_hold from reports where id=$1", [f.report])).rows[0]
      .retention_hold,
  ).toBe(true);
}, 15000);

it("Caps failed transaction attempts and keeps each failed receipt binding", async () => {
  const f = await fixture(),
    relay = localRelayer();
  await control("evm_increaseTime", [100]);
  await finalize();
  const final = await reader.read(f.policy),
    hashes = new Set<Hex>();
  relay.relayer.sendRecovery = vi.fn(async (_key, _escrow, _call, attempt) => {
    const hash = h(400 + Number(attempt));
    hashes.add(hash);
    return { hash, providerId: `reverted-${attempt}` };
  });
  const chain = scanner({
    finalReceipt: async (hash) =>
      hashes.has(hash)
        ? {
            hash,
            status: "reverted",
            blockNumber: final.blockNumber,
            blockHash: final.blockHash,
            logs: [],
          }
        : reader.finalReceipt(hash),
  });
  for (let i = 0; i < 5; i++)
    expect((await processRecovery(pool, chain, relay.relayer, f.bounty)).code).toBe(
      "RECOVERY_TRANSACTION_REVERTED",
    );
  expect(await processRecovery(pool, chain, relay.relayer, f.bounty)).toEqual({
    status: "NEEDS_REVIEW",
    code: "RECOVERY_ATTEMPT_LIMIT",
  });
  expect(relay.relayer.sendRecovery).toHaveBeenCalledTimes(5);
  const rows = (
    await pool.query(
      "select state,idempotency_key,transaction_hash from transaction_intents where request_json->>'bountyId'=$1",
      [f.bounty],
    )
  ).rows;
  expect(rows).toHaveLength(5);
  expect(new Set(rows.map((r) => r.idempotency_key)).size).toBe(5);
  expect(rows.every((r) => r.state === "FAILED" && r.transaction_hash)).toBe(true);
}, 15000);

it("Stops assessment retries after reservation expiry and queues canonical recovery", async () => {
  const f = await fixture();
  await control("evm_increaseTime", [100]);
  await finalize();
  const relay = {
    walletId: serviceWallet,
    send: vi.fn(async () => {
      throw new Error("Must not send");
    }),
  };
  const service = {
    post: vi.fn(async () => {
      throw new Error("Must not assess or release");
    }),
  };
  expect(
    await processClaim(pool, reader, { [ADAPTER_ID]: relay }, { [ADAPTER_ID]: service }, service, f.claim),
  ).toEqual({
    state: "RECOVERY_PENDING",
  });
  expect(
    await processClaim(pool, reader, { [ADAPTER_ID]: relay }, { [ADAPTER_ID]: service }, service, f.claim),
  ).toEqual({
    state: "RECOVERY_PENDING",
  });
  expect(relay.send).not.toHaveBeenCalled();
  expect(service.post).not.toHaveBeenCalled();
  expect(
    (
      await pool.query(
        "select count(*) from outbox where aggregate_id=$1 and event_type='RECOVERY_PROCESS'",
        [f.bounty],
      )
    ).rows[0].count,
  ).toBe("1");
  expect(
    (await pool.query("select retention_hold from reports where id=$1", [f.report])).rows[0]
      .retention_hold,
  ).toBe(true);
}, 15000);

it("Runs the durable recovery queue from an authorized retry through a final refund receipt", async () => {
  // Earlier cases share this isolated database. Keep this queue check scoped to its new bounty.
  await pool.query(
    "insert into bounty_recovery(bounty_id,status) select bounty_id,'COMPLETE' from bounties on conflict(bounty_id) do update set status='COMPLETE'",
  );
  await pool.query("update outbox set processed_at=now() where event_type='RECOVERY_PROCESS'");
  const f = await fixture(),
    relay = localRelayer();
  await control("evm_setNextBlockTimestamp", [Number(f.policy.settlementDeadline) + 1]);
  await finalize();
  const request = {
    method: "POST" as const,
    url: `/api/v1/bounties/${f.bounty}/recovery/retry`,
    headers: headers(),
    payload: {},
  };
  expect((await api.inject(request)).statusCode).toBe(202);
  expect((await api.inject(request)).statusCode).toBe(202);
  const boss = new PgBoss(url.toString()),
    errors: unknown[] = [];
  boss.on("error", (error) => errors.push(error));
  try {
    await boss.start();
    await startRecoveryJobs(boss, pool, reader, relay.relayer);
    let receipt: Record<string, unknown> | undefined;
    for (let i = 0; i < 75; i++) {
      receipt = (
        await pool.query("select category,amount from receipts where bounty_id=$1", [f.bounty])
      ).rows[0];
      if (receipt) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    expect(receipt).toEqual({ category: "REFUND", amount: f.policy.reward });
    expect(relay.relayer.sendRecovery).toHaveBeenCalledTimes(1);
    expect(
      (
        await pool.query(
          "select processed_at from outbox where aggregate_id=$1 and event_type='RECOVERY_PROCESS'",
          [f.bounty],
        )
      ).rows[0].processed_at,
    ).not.toBeNull();
    expect(errors).toHaveLength(0);
  } finally {
    await boss.stop({ graceful: true, timeout: 20000 });
  }
}, 30000);
