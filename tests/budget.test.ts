import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import Fastify from "fastify";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeDeployData,
  encodeFunctionData,
  erc20Abi,
  getCreate2Address,
  type Hex,
  http,
  keccak256,
  parseAbiItem,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { bountyEscrowAbi } from "../packages/chain/src/abi/BountyEscrow.ts";
import { fundingBudgetControllerAbi as abi } from "../packages/chain/src/abi/FundingBudgetController.ts";
import { type ControllerBinding, ReadOnlyBudgetChain } from "../packages/chain/src/budget.ts";
import bytecode from "../packages/chain/src/bytecode/FundingBudgetController.json";
import { matchesControllerRuntime } from "../packages/chain/src/controller-deployment.ts";
import { contractPolicy } from "../packages/chain/src/policy.ts";
import {
  type BudgetExecutor,
  budgetArguments,
  CircleBudgetExecutor,
} from "../packages/circle/src/budget.ts";
import { connectDatabase, databaseUrl } from "../packages/database/src/index.ts";
import { type BountyPolicy, DomainError, hashPolicy } from "../packages/domain/src/index.ts";
import { normalizeGraph } from "../packages/erc4626-coverage-data/src/client.ts";
import { registerBudgetRoutes } from "../services/api/src/budget-routes.ts";
import { allocateBudget } from "../services/budget/src/allocate.ts";
import { registerController, syncApproval } from "../services/budget/src/controllers.ts";
import { enqueueAllocation } from "../services/budget/src/enqueue.ts";
import { a, examplePolicy, h } from "./helpers/policy.ts";

const admin = connectDatabase().pool,
  name = `budget_test_${randomUUID().replaceAll("-", "")}`,
  url = new URL(databaseUrl());
url.pathname = `/${name}`;
const { pool, db } = connectDatabase(url.toString());
const owner = privateKeyToAccount(generatePrivateKey()),
  operator = privateKeyToAccount(generatePrivateKey()),
  userId = randomUUID(),
  operatorId = randomUUID();
let anvil: ChildProcess | undefined,
  rpc: string,
  asset: Hex,
  escrow: Hex,
  reader: ReadOnlyBudgetChain;
let client: ReturnType<typeof createPublicClient>,
  ownerWallet: ReturnType<typeof createWalletClient>,
  operatorWallet: ReturnType<typeof createWalletClient>;
async function local(method: string, params: unknown[]) {
  const result = await (
    await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    })
  ).json();
  if (result.error) throw new Error(result.error.message);
  return result.result;
}
const finalize = () => local("anvil_mine", ["0x40"]);
async function send(to: Hex, data: Hex, asOperator = false) {
  const hash = await (asOperator ? operatorWallet : ownerWallet).sendTransaction({
    account: asOperator ? operator : owner,
    chain: null,
    to,
    data,
  });
  await client.waitForTransactionReceipt({ hash });
  await finalize();
  return hash;
}
beforeAll(async () => {
  await admin.query(`create database ${name}`);
  await migrate(db, { migrationsFolder: "packages/database/migrations" });
  const port = await new Promise<number>((resolve, reject) => {
    const s = createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const info = s.address();
      if (!info || typeof info === "string") return reject(new Error("No port"));
      s.close(() => resolve(info.port));
    });
  });
  rpc = `http://127.0.0.1:${port}`;
  const chain = defineChain({
    id: 31337,
    name: "Local budget test",
    nativeCurrency: { name: "Test ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  });
  anvil = spawn(
    "anvil",
    ["--host", "127.0.0.1", "--port", String(port), "--chain-id", "31337", "--silent"],
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
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  for (const account of [owner, operator])
    await local("anvil_setBalance", [account.address, "0x3635c9adc5dea00000"]);
  ownerWallet = createWalletClient({ account: owner, chain, transport: http(rpc) });
  operatorWallet = createWalletClient({ account: operator, chain, transport: http(rpc) });
  const tokenArtifact = JSON.parse(
      await readFile("contracts/out/TestUSDC.sol/TestUSDC.json", "utf8"),
    ),
    escrowArtifact = JSON.parse(
      await readFile("contracts/out/BountyEscrow.sol/BountyEscrow.json", "utf8"),
    );
  asset = (
    await client.waitForTransactionReceipt({
      hash: await ownerWallet.deployContract({
        account: owner,
        chain,
        abi: tokenArtifact.abi,
        bytecode: tokenArtifact.bytecode.object,
      }),
    })
  ).contractAddress?.toLowerCase() as Hex;
  escrow = (
    await client.waitForTransactionReceipt({
      hash: await ownerWallet.deployContract({
        account: owner,
        chain,
        abi: bountyEscrowAbi,
        bytecode: escrowArtifact.bytecode.object,
        args: [asset],
      }),
    })
  ).contractAddress?.toLowerCase() as Hex;
  await finalize();
  reader = new ReadOnlyBudgetChain(rpc, 31337, escrow);
  await pool.query(
    "insert into users(id,privy_user_id,display_name) values($1::uuid,$1::text,'Budget test')",
    [userId],
  );
  await pool.query(
    "insert into wallets(id,provider,provider_wallet_id,owner_type,owner_id,chain_id,address) values($1::uuid,'CIRCLE',$1::text,'SERVICE',$1,'31337',$2)",
    [operatorId, operator.address.toLowerCase()],
  );
}, 30000);
afterAll(async () => {
  anvil?.kill("SIGTERM");
  await pool.end();
  await admin.query(`drop database if exists ${name}`);
  await admin.end();
});

async function fixture(
  options: { enabled?: boolean; approved?: boolean; perAction?: bigint; daily?: bigint } = {},
) {
  const orgId = randomUUID(),
    walletId = randomUUID(),
    programId = randomUUID(),
    draftId = randomUUID(),
    vaultId = randomUUID(),
    coverageId = randomUUID(),
    recId = randomUUID();
  const organizationId = keccak256(`0x${orgId.replaceAll("-", "")}`);
  const deploymentHash = await ownerWallet.deployContract({
    account: owner,
    chain: null,
    abi,
    bytecode: bytecode.creationBytecode as Hex,
    args: [owner.address, operator.address, organizationId, escrow],
  });
  const controllerAddress = (
    await client.waitForTransactionReceipt({ hash: deploymentHash })
  ).contractAddress?.toLowerCase() as Hex;
  await finalize();
  const binding: ControllerBinding = {
    chainId: 31337,
    address: controllerAddress,
    owner: owner.address.toLowerCase() as Hex,
    operator: operator.address.toLowerCase() as Hex,
    organizationId,
    escrow,
    asset,
  };
  await pool.query(
    "insert into organizations(id,onchain_id,name,owner_user_id) values($1,$2,'Budget organization',$3)",
    [orgId, organizationId, userId],
  );
  await pool.query("insert into memberships(organization_id,user_id,role) values($1,$2,'OWNER')", [
    orgId,
    userId,
  ]);
  await pool.query(
    "insert into wallets(id,provider,provider_wallet_id,owner_type,owner_id,chain_id,address) values($1::uuid,'PRIVY',$1::text,'ORGANIZATION',$2,'31337',$3)",
    [walletId, orgId, binding.owner],
  );
  const c = await pool.connect();
  let controllerId: string;
  try {
    await c.query("begin");
    controllerId = (
      await registerController(
        c,
        reader,
        {
          organizationId: orgId,
          ownerWalletId: walletId,
          operatorWalletId: operatorId,
          address: controllerAddress,
          deploymentHash,
        },
        binding,
      )
    ).id;
    await c.query("commit");
  } finally {
    c.release();
  }
  const timestamp = (await client.getBlock()).timestamp;
  const policy: BountyPolicy = {
    ...examplePolicy(),
    organizationId,
    escrow,
    asset,
    refundRecipient: controllerAddress,
    reward: "1000000",
    submissionDeadline: String(timestamp + 100000n),
    settlementDeadline: String(timestamp + 110000n),
  };
  await pool.query("insert into programs(id,organization_id,name) values($1,$2,'Budget program')", [
    programId,
    orgId,
  ]);
  await pool.query(
    "insert into bounty_drafts(id,program_id,policy_json,policy_hash,created_by,approved_by,status) values($1,$2,$3,$4,$5,$5,'APPROVED')",
    [draftId, programId, JSON.stringify(policy), hashPolicy(policy), userId],
  );
  await pool.query(
    "insert into registered_vaults(id,organization_id,source_chain_id,address,label) values($1,$2,'1',$3,'Synthetic budget context')",
    [vaultId, orgId, policy.sourceVault],
  );
  await pool.query(
    "insert into coverage_policies(id,organization_id,version_number,min_reward,allowed_vault_ids,approved_by) values($1,$2,1,'1000000',$3,$4)",
    [coverageId, orgId, JSON.stringify([vaultId]), userId],
  );
  await send(
    controllerAddress,
    encodeFunctionData({
      abi,
      functionName: "setLimits",
      args: [options.perAction ?? 1000000n, options.daily ?? 2000000n, 60n],
    }),
  );
  if (options.approved !== false)
    await send(
      controllerAddress,
      encodeFunctionData({
        abi,
        functionName: "approvePolicy",
        args: [hashPolicy(policy), 1000000n, timestamp + 100000n],
      }),
    );
  await send(
    asset,
    encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [controllerAddress, 3000000n],
    }),
  );
  if (options.enabled !== false)
    await send(
      controllerAddress,
      encodeFunctionData({ abi, functionName: "setEnabled", args: [true] }),
    );
  if (options.approved !== false) await syncApproval(pool, reader, controllerId, draftId);
  await pool.query(
    "insert into recommendations(id,organization_id,source_ids,policy_id,calculation_json,explanation,action_json,expires_at,status) values($1,$2,'[]',$3,$4,'Local source fixture',$5,now()+interval '5 minutes','ACTIONABLE')",
    [
      recId,
      orgId,
      coverageId,
      JSON.stringify({ vaultId }),
      JSON.stringify({
        kind: "FUND_APPROVED_POLICY",
        controllerId,
        policyHash: hashPolicy(policy),
      }),
    ],
  );
  let actionId: string;
  const request = await pool.connect();
  try {
    await request.query("begin");
    actionId = (await enqueueAllocation(request, orgId, recId)).id;
    await request.query("commit");
  } finally {
    request.release();
  }
  let stale = false,
    lose = false;
  const source = {
    query: vi.fn(async () => {
      const block = await client.getBlock({ blockTag: "finalized" }),
        time = block.timestamp - (stale ? 1000n : 0n);
      return normalizeGraph(
        {
          vaults: [
            {
              id: `1:${policy.sourceVault}`,
              chainId: "1",
              address: policy.sourceVault,
              asset: a(9),
              assetDecimals: 18,
              shareDecimals: 18,
              implementationLabel: "Synthetic context",
              firstObservedBlock: "1",
              latestObservation: {
                id: "local:100",
                blockNumber: "100",
                blockHash: h(88),
                blockTimestamp: String(time),
                totalAssets: "1000000000000000000",
                totalSupply: "1000000000000000000",
                readStatus: "OK",
                schemaVersion: "1",
              },
            },
          ],
          sourceCursors: [],
          _meta: {
            deployment: "LocalBudgetFixture",
            hasIndexingErrors: false,
            block: { number: 100, hash: h(88), timestamp: Number(time) },
          },
        },
        [`1:${policy.sourceVault}`],
        new Date(Number(block.timestamp) * 1000),
      );
    }),
  };
  const calls = new Map<string, Hex>();
  const executor: BudgetExecutor = {
    walletId: operatorId,
    send: vi.fn(async (key, _binding, p) => {
      let hash = calls.get(key);
      if (!hash) {
        hash = await send(
          controllerAddress,
          encodeFunctionData({
            abi,
            functionName: "fundApprovedPolicy",
            args: [contractPolicy(p)],
          }),
          true,
        );
        calls.set(key, hash);
      }
      if (lose) {
        lose = false;
        throw new Error("Lost allocation response");
      }
      return { hash, providerId: key };
    }),
  };
  return {
    binding,
    deploymentHash,
    controllerId,
    policy,
    orgId,
    actionId,
    executor,
    source,
    calls,
    stale: () => {
      stale = true;
    },
    lose: () => {
      lose = true;
    },
  };
}

it("reconciles a final allocation after a lost response without a second payment", async () => {
  const f = await fixture();
  f.lose();
  await expect(allocateBudget(pool, reader, f.executor, f.source, f.actionId)).rejects.toThrow(
    "Lost allocation response",
  );
  expect(await allocateBudget(pool, reader, f.executor, f.source, f.actionId)).toEqual({
    state: "COMPLETE",
  });
  expect(await allocateBudget(pool, reader, f.executor, f.source, f.actionId)).toEqual({
    state: "COMPLETE",
  });
  expect(f.executor.send).toHaveBeenCalledTimes(1);
  expect(f.calls.size).toBe(1);
  expect(
    (
      await pool.query(
        "select state,transaction_hash from transaction_intents where wallet_id=$1 and request_json->>'controller'=$2",
        [operatorId, f.binding.address],
      )
    ).rows[0],
  ).toMatchObject({ state: "CONFIRMED", transaction_hash: [...f.calls.values()][0] });
  expect(
    (
      await pool.query("select chain_state,unallocated_reward from bounties where bounty_id=$1", [
        hashPolicy(f.policy),
      ])
    ).rows[0],
  ).toEqual({ chain_state: "FUNDED", unallocated_reward: "1000000" });
  expect(
    (await pool.query("select count(*) from receipts where organization_id=$1", [f.orgId])).rows[0]
      .count,
  ).toBe("1");
  expect((await reader.read(f.binding, hashPolicy(f.policy))).approval.consumed).toBe(true);
  await expect(
    pool.query("update budget_controllers set address=$2 where id=$1", [f.controllerId, a(100)]),
  ).rejects.toThrow("immutable");
  await expect(
    pool.query("update transaction_intents set request_json='{}' where wallet_id=$1", [operatorId]),
  ).rejects.toThrow("immutable");
}, 30000);

it.each([
  [{ enabled: false }, "CONTROLLER_DISABLED"],
  [{ approved: false }, "POLICY_NOT_APPROVED"],
  [{ perAction: 500000n }, "BUDGET_LIMIT"],
] as const)(
  "rejects an allocation when its current controller state does not permit it",
  async (options, code) => {
    const f = await fixture(options);
    expect(await allocateBudget(pool, reader, f.executor, f.source, f.actionId)).toEqual({
      state: "REJECTED",
      code,
    });
    expect(f.executor.send).not.toHaveBeenCalled();
  },
  30000,
);

it("rejects stale source data before creating a payment request", async () => {
  const f = await fixture();
  f.stale();
  expect(await allocateBudget(pool, reader, f.executor, f.source, f.actionId)).toEqual({
    state: "REJECTED",
    code: "STALE_OBSERVATION",
  });
  expect(f.executor.send).not.toHaveBeenCalled();
  expect(
    (await pool.query("select tx_intent_id from agent_actions where id=$1", [f.actionId])).rows[0]
      .tx_intent_id,
  ).toBeNull();
}, 30000);

it("serializes concurrent jobs for one controller", async () => {
  const f = await fixture();
  const results = await Promise.allSettled([
    allocateBudget(pool, reader, f.executor, f.source, f.actionId),
    allocateBudget(pool, reader, f.executor, f.source, f.actionId),
  ]);
  expect(results.some((r) => r.status === "fulfilled" && r.value.state === "COMPLETE")).toBe(true);
  expect(f.executor.send).toHaveBeenCalledTimes(1);
  expect(f.calls.size).toBe(1);
}, 30000);

it("uses cumulative daily spending when a second policy requests funds", async () => {
  const f = await fixture({ daily: 1000000n });
  expect(await allocateBudget(pool, reader, f.executor, f.source, f.actionId)).toEqual({
    state: "COMPLETE",
  });
  const policy = { ...f.policy, organizationNonce: h(12345) },
    hash = hashPolicy(policy),
    draftId = randomUUID();
  await pool.query(
    "insert into bounty_drafts(id,program_id,policy_json,policy_hash,created_by,approved_by,status) select $1,program_id,$2,$3,created_by,approved_by,'APPROVED' from bounty_drafts where policy_hash=$4",
    [draftId, JSON.stringify(policy), hash, hashPolicy(f.policy)],
  );
  await send(
    f.binding.address,
    encodeFunctionData({
      abi,
      functionName: "approvePolicy",
      args: [hash, 1000000n, BigInt(policy.submissionDeadline)],
    }),
  );
  const recId = randomUUID();
  await pool.query(
    "insert into recommendations(id,organization_id,source_ids,policy_id,calculation_json,explanation,action_json,expires_at,status) select $1,organization_id,source_ids,policy_id,calculation_json,explanation,$2,now()+interval '5 minutes','ACTIONABLE' from recommendations where id=(select recommendation_id from agent_actions where id=$3)",
    [
      recId,
      JSON.stringify({
        kind: "FUND_APPROVED_POLICY",
        controllerId: f.controllerId,
        policyHash: hash,
      }),
      f.actionId,
    ],
  );
  const c = await pool.connect();
  let nextId: string;
  try {
    await c.query("begin");
    nextId = (await enqueueAllocation(c, f.orgId, recId)).id;
    await c.query("commit");
  } finally {
    c.release();
  }
  expect(await allocateBudget(pool, reader, f.executor, f.source, nextId)).toEqual({
    state: "REJECTED",
    code: "BUDGET_LIMIT",
  });
  expect(f.executor.send).toHaveBeenCalledTimes(1);
}, 30000);

it("verifies the deployed bytecode and every immutable controller field", async () => {
  const f = await fixture();
  await expect(
    reader.verifyDeployment({ ...f.binding, owner: a(99) }, f.deploymentHash),
  ).rejects.toMatchObject({ code: "CONTROLLER_CODE_MISMATCH" });
  await expect(reader.read({ ...f.binding, operator: a(99) }, h(0))).rejects.toMatchObject({
    code: "CONTROLLER_BINDING_MISMATCH",
  });
}, 30000);

it("verifies factory creation with the exact code, constructor, salt, and factory code", async () => {
  const f = await fixture();
  const artifact = JSON.parse(
    await readFile("contracts/out/LocalDeploymentFactory.sol/LocalDeploymentFactory.json", "utf8"),
  );
  const deployed = await ownerWallet.deployContract({
    account: owner,
    chain: null,
    abi: artifact.abi,
    bytecode: artifact.bytecode.object,
  });
  const factory = (
    await client.waitForTransactionReceipt({ hash: deployed })
  ).contractAddress?.toLowerCase() as Hex;
  const creationCode = encodeDeployData({
      abi,
      bytecode: bytecode.creationBytecode as Hex,
      args: [f.binding.owner, f.binding.operator, f.binding.organizationId, escrow],
    }),
    salt = h(888);
  const target = getCreate2Address({
    from: factory,
    salt,
    bytecode: creationCode,
  }).toLowerCase() as Hex;
  const tx = await send(
    factory,
    encodeFunctionData({ abi: artifact.abi, functionName: "deploy", args: [creationCode, salt] }),
  );
  const factoryCode = await client.getCode({ address: factory });
  if (!factoryCode) throw new Error("Missing factory code");
  const adapter = new ReadOnlyBudgetChain(rpc, 31337, escrow, {
      address: factory,
      runtimeCodeHash: keccak256(factoryCode),
    }),
    binding = { ...f.binding, address: target };
  expect(await adapter.verifyDeployment(binding, tx)).toMatchObject({
    transactionHash: tx,
    creation: { method: "CREATE2", salt, factory },
  });
  await expect(adapter.verifyDeployment({ ...binding, owner: a(100) }, tx)).rejects.toMatchObject({
    code: "CONTROLLER_CODE_MISMATCH",
  });
  await expect(
    new ReadOnlyBudgetChain(rpc, 31337, escrow, {
      address: factory,
      runtimeCodeHash: h(99),
    }).verifyDeployment(binding, tx),
  ).rejects.toMatchObject({ code: "CONTROLLER_CODE_MISMATCH" });
  const runtime = await client.getCode({ address: target });
  if (!runtime) throw new Error("Missing controller code");
  expect(matchesControllerRuntime(runtime)).toBe(true);
  expect(matchesControllerRuntime(`0xff${runtime.slice(4)}`)).toBe(false);
}, 30000);

it("round-trips the exact budget tuple through the Circle CLI parser", async () => {
  const source = await readFile("node_modules/@circle-fin/cli/dist/index.js", "utf8"),
    match = source.match(
      /const abiParameters = pos\.slice\(1\)\.map\(\(value\) => \{([\s\S]*?)\n {2}\}\);/,
    );
  if (!match) throw new Error("The pinned CLI parser is missing.");
  const parser = new Function("value", match[1]),
    policy = examplePolicy(),
    [signature, ...params] = budgetArguments(policy);
  expect(
    encodeFunctionData({
      abi: [parseAbiItem(`function ${signature}`)],
      functionName: "fundApprovedPolicy",
      args: params.map((v) => parser(v)),
    }),
  ).toBe(
    encodeFunctionData({ abi, functionName: "fundApprovedPolicy", args: [contractPolicy(policy)] }),
  );
});

it("checks current membership for budget reads and preserves one retry request", async () => {
  const f = await fixture(),
    app = Fastify();
  app.decorateRequest("actor");
  app.addHook("onRequest", async (request) => {
    request.actor = { id: userId, displayName: "Budget owner" };
  });
  app.setErrorHandler((error, _request, reply) =>
    reply
      .code(error instanceof DomainError ? error.status : 500)
      .send({ message: error instanceof Error ? error.message : "Test error" }),
  );
  registerBudgetRoutes(app, pool, { chain: reader, network: f.binding });
  try {
    const path = `/api/v1/controllers/${f.controllerId}/approvals`;
    const read = await app.inject({ url: path });
    expect(read.statusCode).toBe(200);
    expect(read.json().items[0].policy_hash).toBe(hashPolicy(f.policy));
    const request = {
      method: "POST" as const,
      url: `/api/v1/allocations/${f.actionId}/retry`,
      headers: { "idempotency-key": randomUUID() },
      payload: {},
    };
    const retry = await app.inject(request);
    expect(retry.statusCode).toBe(202);
    expect((await app.inject(request)).json().version).toBe(retry.json().version);
    expect(
      (
        await pool.query(
          "select count(*) from outbox where aggregate_id=$1 and event_type='BUDGET_ALLOCATION'",
          [f.actionId],
        )
      ).rows[0].count,
    ).toBe("2");
    await pool.query(
      "update memberships set role='VIEWER' where organization_id=$1 and user_id=$2",
      [f.orgId, userId],
    );
    expect(
      (await app.inject({ ...request, headers: { "idempotency-key": randomUUID() } })).statusCode,
    ).toBe(403);
    expect((await app.inject({ url: path })).statusCode).toBe(200);
    await pool.query("delete from memberships where organization_id=$1 and user_id=$2", [
      f.orgId,
      userId,
    ]);
    expect((await app.inject({ url: path })).statusCode).toBe(404);
  } finally {
    await app.close();
  }
}, 30000);

it("keeps one Circle request ID on retries and rejects a different controller", async () => {
  const policy = { ...examplePolicy(), settlementChainId: "5042002" },
    binding: ControllerBinding = {
      chainId: 5042002,
      address: policy.refundRecipient,
      owner: a(8),
      operator: a(9),
      organizationId: policy.organizationId,
      escrow: policy.escrow,
      asset: policy.asset,
    };
  const calls: string[][] = [],
    executor = new CircleBudgetExecutor(
      randomUUID(),
      binding.operator,
      binding.escrow,
      async (args) => {
        calls.push(args);
        if (calls.length === 1) throw new Error("Lost Circle response");
        return {
          id: "test",
          idempotencyKey: args[args.indexOf("--idempotency-key") + 1],
          txHash: h(99),
          blockchain: "ARC-TESTNET",
          sourceAddress: binding.operator,
          contractAddress: binding.address,
        };
      },
    );
  const key = `allocation:${binding.address}:${hashPolicy(policy)}`;
  await expect(executor.send(key, binding, policy)).rejects.toThrow("Lost Circle response");
  expect(await executor.send(key, binding, policy)).toEqual({ hash: h(99), providerId: "test" });
  expect(calls[0]).toEqual(calls[1]);
  await expect(executor.send(key, { ...binding, address: a(100) }, policy)).rejects.toMatchObject({
    code: "ALLOCATION_SCOPE",
  });
  expect(calls).toHaveLength(2);
});
