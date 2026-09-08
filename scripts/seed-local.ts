import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  erc20Abi,
  type Hex,
  http,
  keccak256,
  toHex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { bountyEscrowAbi } from "../packages/chain/src/abi/BountyEscrow.ts";
import { ReadOnlyBountyChain } from "../packages/chain/src/bounty-reader.ts";
import { contractPolicy } from "../packages/chain/src/policy.ts";
import { createEncryptionKeyPair, hashCanonical } from "../packages/crypto-envelope/src/index.ts";
import { connectDatabase } from "../packages/database/src/index.ts";
import { ADAPTER_ID, hashPolicy, policySchema } from "../packages/domain/src/index.ts";
import { createManifestCases } from "../packages/fixture-manifest/src/index.ts";
import { publicConfigSchema } from "../packages/service-config/src/index.ts";
import { createApp } from "../services/api/src/app.ts";
import { LocalAuthProvider } from "../services/api/src/auth.ts";
import { OrganizationKeyStore } from "../services/report-release/src/keys.ts";
import { LocalSeedError, localSeedScope } from "./local-seed-scope.ts";

// Do not load .env. This command requires a separate, explicit local scope.
async function seed() {
  if (process.argv.slice(2).some((arg) => arg !== "--check"))
    throw new LocalSeedError("Use seed:local with no arguments or --check.");
  const scope = localSeedScope(process.env);
  const transport = http(scope.rpc, {
    retryCount: 0,
    timeout: 5000,
    fetchOptions: { redirect: "error" },
  });
  const client = createPublicClient({ transport, pollingInterval: 50 });
  if ((await client.getChainId()) !== 31337)
    throw new LocalSeedError("Seed setup refuses every chain except local chain 31337.");
  const version = await client.request({ method: "web3_clientVersion" });
  if (!version.toLowerCase().startsWith("anvil/"))
    throw new LocalSeedError("Seed setup requires an Anvil node.");
  const adminUrl = new URL(scope.database);
  adminUrl.pathname = "/postgres";
  const admin = connectDatabase(adminUrl.toString()).pool;
  const { db, pool } = connectDatabase(scope.database);
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    if ((await admin.query("select 1 from pg_database where datname=$1", [scope.name])).rowCount)
      throw new LocalSeedError(
        "The seed database already exists. Use its saved files or choose a new seed name.",
      );
    const tokenArtifact = JSON.parse(
      await readFile("contracts/out/TestUSDC.sol/TestUSDC.json", "utf8"),
    );
    const escrowArtifact = JSON.parse(
      await readFile("contracts/out/BountyEscrow.sol/BountyEscrow.json", "utf8"),
    );
    if (process.argv.includes("--check")) {
      process.stdout.write(
        "Local Anvil, unused database name, and contract artifacts are available. No state changed.\n",
      );
      return;
    }
    const parent = resolve(".local/seeds");
    await mkdir(parent, { recursive: true, mode: 0o700 });
    if (!(await realpath(parent)).startsWith(`${await realpath(process.cwd())}${sep}`))
      throw new LocalSeedError("Seed files must remain inside this workspace.");
    const directory = resolve(parent, scope.name);
    await mkdir(directory, { mode: 0o700 });
    const save = async (name: string, value: unknown) => {
      await writeFile(resolve(directory, name), `${JSON.stringify(value, null, 2)}\n`, {
        mode: 0o600,
        flag: "wx",
      });
    };
    await save("scope.json", {
      schemaVersion: 1,
      environment: "local",
      chainId: 31337,
      databaseName: scope.name,
      rpc: scope.rpc,
      createdAt: new Date().toISOString(),
    });
    // The strict database-name rule above permits only this SQL identifier.
    await admin.query(`create database "${scope.name}"`);
    await migrate(db, { migrationsFolder: "packages/database/migrations" });
    const roles = ["OWNER", "TREASURY", "REVIEWER", "RESEARCHER", "OUTSIDER"] as const;
    const actors = roles.map((role) => ({
      role,
      privateKey: generatePrivateKey(),
      token: randomBytes(32).toString("hex"),
      subject: `local:seed:${randomUUID()}`,
      displayName: `Local ${role.toLowerCase()}`,
    }));
    await save("actors.json", actors);
    const auth = new LocalAuthProvider(actors, "local");
    app = await createApp({ pool, auth, appEnv: "local", webOrigin: "http://127.0.0.1:5173" });
    const api = app;
    async function request(actor: number, path: string, body?: Record<string, unknown>) {
      const response = await api.inject({
        method: body ? "POST" : "GET",
        url: `/api/v1${path}`,
        headers: {
          authorization: `Bearer ${actors[actor].token}`,
          "idempotency-key": randomUUID(),
        },
        payload: body,
      });
      if (response.statusCode >= 300)
        throw new LocalSeedError("The local seed API request failed.");
      return response.json();
    }
    const userIds: string[] = [];
    for (let i = 0; i < actors.length; i++) userIds.push((await request(i, "/me")).user.id);
    const org = await request(0, "/organizations", { name: "Local synthetic fixture program" });
    for (const i of [1, 2])
      await request(0, `/organizations/${org.id}/members`, {
        userId: userIds[i],
        role: roles[i],
      });
    const program = await request(0, `/organizations/${org.id}/programs`, {
      name: "Local fixture checks",
    });
    const orgKey = await new OrganizationKeyStore(resolve(directory, "organization-keys")).ensure(
      pool,
      org.id,
    );
    const admissionKey = generatePrivateKey(),
      verdictKey = generatePrivateKey();
    const evidenceKeys = await createEncryptionKeyPair(),
      researcherKeys = await createEncryptionKeyPair();
    const identities: Record<string, string> = {};
    for (const role of ["api", "worker", "verifier", "report-release"]) {
      const pair = generateKeyPairSync("ed25519");
      const publicKey = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
      identities[role] = publicKey;
      await save(`${role}-identity.json`, {
        testnetOnly: true,
        publicKey,
        privateKey: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      });
    }
    await save("verifier-secrets.json", {
      testnetOnly: true,
      admissionKey,
      verdictKey,
      evidenceKeys,
      researcherKeys,
    });
    const sources = [
      "services/verifier/src/fixture.ts",
      "packages/domain/src/fixture-leaf.ts",
      "packages/domain/src/index.ts",
      "packages/crypto-envelope/src/index.ts",
    ];
    const sourceHashes = Object.fromEntries(
      await Promise.all(
        sources.map(async (path) => [path, keccak256(toHex(await readFile(path, "utf8")))]),
      ),
    );
    const adapterCodeHash = hashCanonical({
      sources: sourceHashes,
      dependencies: { viem: "2.56.3", zod: "4.5.4", merkleTree: "1.0.8", libsodium: "0.8.4" },
    });
    const config = publicConfigSchema.parse({
      schemaVersion: "1",
      testnetOnly: true,
      evidenceScope: "FIXTURE_ONLY",
      verifierMode: "TRUSTED_SERVICE",
      evidenceKeyId: keccak256(toHex(evidenceKeys.publicKey)),
      evidencePublicKey: evidenceKeys.publicKey,
      admissionSigner: privateKeyToAccount(admissionKey).address.toLowerCase(),
      verdictSigner: privateKeyToAccount(verdictKey).address.toLowerCase(),
      adapterCodeHash,
      verifierConfigHash: hashCanonical({
        adapterCodeHash,
        evidenceScope: "FIXTURE_ONLY",
        verifierMode: "TRUSTED_SERVICE",
        maximumEvidenceBytes: "262144",
        schemaVersion: "1",
      }),
      serviceIdentities: identities,
    });
    await save("public-services.json", config);
    const owner = privateKeyToAccount(actors[0].privateKey);
    const chain = defineChain({
      id: 31337,
      name: "Local Anvil",
      nativeCurrency: {
        name: "Local ETH",
        symbol: "ETH",
        decimals: 18,
      },
      rpcUrls: { default: { http: [scope.rpc] } },
    });
    const wallet = createWalletClient({ account: owner, chain, transport });
    const anvil = async (method: string, params: unknown[]) => {
      const response = await fetch(scope.rpc, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(5000),
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      if (!response.ok || (await response.json()).error)
        throw new LocalSeedError("The local Anvil request failed.");
    };
    await anvil("anvil_setBalance", [owner.address, "0x3635c9adc5dea00000"]);
    const receipt = async (hash: Hex) => {
      const result = await client.waitForTransactionReceipt({ hash, timeout: 15000 });
      if (result.status !== "success")
        throw new LocalSeedError("A local seed transaction reverted.");
      return result;
    };
    const asset = (
      await receipt(
        await wallet.deployContract({
          abi: tokenArtifact.abi,
          bytecode: tokenArtifact.bytecode.object,
        }),
      )
    ).contractAddress;
    if (!asset) throw new LocalSeedError("The local token deployment has no address.");
    const escrow = (
      await receipt(
        await wallet.deployContract({
          abi: bountyEscrowAbi,
          bytecode: escrowArtifact.bytecode.object,
          args: [asset],
        }),
      )
    ).contractAddress;
    if (!escrow) throw new LocalSeedError("The local escrow deployment has no address.");
    const randomHash = () => toHex(randomBytes(32));
    const catalog = createManifestCases(
      [randomHash(), randomHash(), randomHash()],
      [randomHash(), randomHash(), randomHash()],
    );
    await save("fixtures.json", catalog);
    const latest = await client.getBlock();
    await receipt(
      await wallet.writeContract({
        address: asset,
        abi: erc20Abi,
        functionName: "approve",
        args: [escrow, 3000000n],
      }),
    );
    const bounties = [];
    for (const fixture of catalog.fixtures) {
      const policy = policySchema.parse({
        settlementChainId: "31337",
        escrow: escrow.toLowerCase(),
        organizationId: org.onchain_id,
        refundRecipient: owner.address.toLowerCase(),
        sourceChainId: "31337",
        sourceVault: toHex(999, { size: 20 }),
        sourceBlockHash: latest.hash,
        fixtureManifestRoot: catalog.root,
        adapterId: ADAPTER_ID,
        adapterCodeHash,
        verifierConfigHash: config.verifierConfigHash,
        admissionSigner: config.admissionSigner,
        verdictSigner: config.verdictSigner,
        reportRecipientKeyId: orgKey.keyId,
        asset: asset.toLowerCase(),
        reward: "1000000",
        minimumDiscrepancy: "1000000",
        submissionDeadline: String(latest.timestamp + 86400n),
        settlementDeadline: String(latest.timestamp + 90000n),
        reservationDurationSeconds: "1800",
        organizationNonce: randomHash(),
      });
      const funded = await receipt(
        await wallet.writeContract({
          address: escrow,
          abi: bountyEscrowAbi,
          functionName: "createAndFund",
          args: [contractPolicy(policy)],
        }),
      );
      await anvil("anvil_mine", ["0x40"]);
      const snapshot = await new ReadOnlyBountyChain(scope.rpc, 31337, policy.escrow).read(policy);
      if (snapshot.state !== 1 || snapshot.unallocatedReward !== 1000000n)
        throw new LocalSeedError("The final local bounty does not match its seeded reward.");
      const logs = funded.logs
        .filter((log) => log.address.toLowerCase() === policy.escrow)
        .map((log) => ({
          log,
          event: decodeEventLog({ abi: bountyEscrowAbi, data: log.data, topics: log.topics }),
        }));
      const fundedLogs = logs.filter(({ event }) => event.eventName === "BountyFunded");
      if (fundedLogs.length !== 1)
        throw new LocalSeedError("The local funding receipt must contain one funded event.");
      const { log, event } = fundedLogs[0];
      if (
        event.eventName !== "BountyFunded" ||
        event.args.bountyId !== hashPolicy(policy) ||
        event.args.organizationId !== org.onchain_id ||
        event.args.policyHash !== hashPolicy(policy) ||
        event.args.reward !== 1000000n ||
        event.args.asset.toLowerCase() !== policy.asset
      )
        throw new LocalSeedError("The local funding event fields do not match the policy.");
      await pool.query(
        "insert into bounties(bounty_id,program_id,policy_hash,policy_json,chain_id,escrow,reward,unallocated_reward,chain_state,creation_tx) values($1,$2,$1,$3,'31337',$4,'1000000','1000000','FUNDED',$5)",
        [
          hashPolicy(policy),
          program.id,
          JSON.stringify(policy),
          policy.escrow,
          funded.transactionHash,
        ],
      );
      const eventRow = await pool.query(
        "insert into chain_events(chain_id,transaction_hash,log_index,block_number,block_hash,name,payload_json,finality_state,contract_address) values('31337',$1,$2,$3,$4,'BountyFunded',$5,'FINAL',$6) returning id",
        [
          funded.transactionHash,
          log.logIndex,
          String(funded.blockNumber),
          funded.blockHash,
          JSON.stringify({ ...event.args, reward: String(event.args.reward) }),
          policy.escrow,
        ],
      );
      await pool.query(
        "insert into receipts(organization_id,bounty_id,category,amount,asset,event_id,status) values($1,$2,'FUNDING','1000000',$3,$4,'FINAL')",
        [org.id, hashPolicy(policy), policy.asset, eventRow.rows[0].id],
      );
      bounties.push({
        label: fixture.label,
        bountyId: hashPolicy(policy),
        policy,
        transactionHash: funded.transactionHash,
        blockHash: funded.blockHash,
        blockNumber: String(funded.blockNumber),
      });
    }
    const wallets = [];
    for (let i = 0; i < actors.length; i++) {
      const address = privateKeyToAccount(actors[i].privateKey).address.toLowerCase();
      const result = await pool.query(
        "insert into wallets(provider,provider_wallet_id,owner_type,owner_id,chain_id,address) values('PRIVY',$1,'USER',$2,'31337',$3) returning id",
        [`local-seed:${scope.name}:${roles[i]}`, userIds[i], address],
      );
      wallets.push({ role: roles[i], userId: userIds[i], walletId: result.rows[0].id, address });
    }
    await save("runtime.json", { databaseUrl: scope.database, rpc: scope.rpc, directory });
    await save("seed.json", {
      schemaVersion: 1,
      environment: "local",
      synthetic: true,
      providerMode: "LOCAL_TEST_DOUBLES",
      liveSponsorEvidence: false,
      chainId: 31337,
      organizationId: org.id,
      programId: program.id,
      asset: asset.toLowerCase(),
      escrow: escrow.toLowerCase(),
      wallets,
      bounties,
      adapterCodeHash,
    });
    process.stdout.write(
      `Local seed complete: ${directory}/seed.json\nThree local bounties have final funding. No sponsor account was used.\n`,
    );
  } finally {
    await app?.close();
    await pool.end();
    await admin.end();
  }
}
try {
  await seed();
} catch (error) {
  // Provider and PostgreSQL errors can contain connection details. Do not print them.
  const message =
    error instanceof LocalSeedError
      ? error.message
      : "Local seed setup failed. Check the local services and use a new seed name after a partial run.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
