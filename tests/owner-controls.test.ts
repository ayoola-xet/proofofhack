import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import Fastify from "fastify";
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  erc20Abi,
  type Hex,
  keccak256,
  type Log,
  parseTransaction,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { z } from "zod";
import { fundingBudgetControllerAbi as abi } from "../packages/chain/src/abi/FundingBudgetController.ts";
import { ARC_USDC } from "../packages/chain/src/arc.ts";
import type {
  BudgetChain,
  ControllerBinding,
  ControllerSnapshot,
} from "../packages/chain/src/budget.ts";
import type { FundingChain, FundingReceipt } from "../packages/chain/src/funding.ts";
import { type OwnerCommand, ownerCall } from "../packages/chain/src/owner-command.ts";
import { connectDatabase, databaseUrl } from "../packages/database/src/index.ts";
import { DomainError, hashPolicy } from "../packages/domain/src/index.ts";
import type { OwnerPermission } from "../packages/privy/src/owner-permission.ts";
import { registerOwnerRoutes } from "../services/api/src/owner-routes.ts";
import { type OwnerProvider, processOwnerRequest } from "../services/budget/src/owner-process.ts";
import { a, examplePolicy, h } from "./helpers/policy.ts";

const admin = connectDatabase().pool,
  databaseName = `owner_test_${randomUUID().replaceAll("-", "")}`,
  url = new URL(databaseUrl());
url.pathname = `/${databaseName}`;
const { pool, db } = connectDatabase(url.toString()),
  actors = [randomUUID(), randomUUID()],
  authorizer = privateKeyToAccount(generatePrivateKey()),
  authorizerId = randomUUID();
const app = Fastify();
let linked = true;
const identities = {
  userWallets: vi.fn(async () =>
    linked ? [{ providerWalletId: authorizerId, address: authorizer.address.toLowerCase() }] : [],
  ),
};
app.decorateRequest("actor");
app.addHook("onRequest", async (r) => {
  r.actor = { id: actors[Number(r.headers["test-actor"] ?? 0)], displayName: "Owner test" };
});
app.setErrorHandler((error, _r, reply) =>
  reply
    .code(error instanceof DomainError ? error.status : error instanceof z.ZodError ? 400 : 500)
    .send({ message: error instanceof Error ? error.message : "Test error" }),
);
registerOwnerRoutes(
  app,
  pool,
  {
    network: { chainId: 5042002, escrow: a(1), operator: a(99), asset: ARC_USDC },
    chain: {} as BudgetChain,
  },
  identities,
);
beforeAll(async () => {
  await admin.query(`create database ${databaseName}`);
  await migrate(db, { migrationsFolder: "packages/database/migrations" });
  for (const actor of actors)
    await pool.query(
      "insert into users(id,privy_user_id,display_name) values($1::uuid,$1::text,'Owner test')",
      [actor],
    );
  await pool.query(
    "insert into wallets(id,provider,provider_wallet_id,owner_type,owner_id,chain_id,address) values($1::uuid,'PRIVY',$1::text,'USER',$2,'5042002',$3)",
    [authorizerId, actors[0], authorizer.address.toLowerCase()],
  );
});
afterAll(async () => {
  await app.close();
  await pool.end();
  await admin.query(`drop database if exists ${databaseName}`);
  await admin.end();
});
const headers = (actor = 0) => ({ "test-actor": String(actor), "idempotency-key": randomUUID() });

async function fixture(kind: OwnerCommand["kind"] = "DEPOSIT") {
  linked = true;
  const owner = privateKeyToAccount(generatePrivateKey()),
    orgId = randomUUID(),
    walletId = randomUUID(),
    operatorId = randomUUID(),
    controllerId = randomUUID(),
    draftId = randomUUID(),
    programId = randomUUID();
  const binding: ControllerBinding = {
    chainId: 5042002,
    owner: owner.address.toLowerCase() as Hex,
    operator: a(99),
    address: `0x${controllerId.replaceAll("-", "")}00000000` as Hex,
    organizationId: keccak256(`0x${orgId.replaceAll("-", "")}`),
    escrow: a(1),
    asset: ARC_USDC,
  };
  const policy = {
    ...examplePolicy(),
    settlementChainId: "5042002",
    organizationId: binding.organizationId,
    asset: ARC_USDC,
    escrow: binding.escrow,
    refundRecipient: binding.address,
    reward: "1000000",
    submissionDeadline: String(Math.floor(Date.now() / 1000) + 7200),
    settlementDeadline: String(Math.floor(Date.now() / 1000) + 10800),
  };
  await pool.query(
    "insert into organizations(id,onchain_id,name,owner_user_id) values($1,$2,'Owner controls',$3)",
    [orgId, binding.organizationId, actors[0]],
  );
  await pool.query(
    "insert into memberships(organization_id,user_id,role) values($1,$2,'OWNER'),($1,$3,'TREASURY')",
    [orgId, actors[0], actors[1]],
  );
  await pool.query(
    "insert into wallets(id,provider,provider_wallet_id,owner_type,owner_id,chain_id,address) values($1::uuid,'PRIVY',$1::text,'ORGANIZATION',$2,'5042002',$3),($4::uuid,'CIRCLE',$4::text,'SERVICE',$4,'5042002',$5)",
    [walletId, orgId, binding.owner, operatorId, binding.operator],
  );
  await pool.query(
    "insert into wallet_setups(organization_id,requested_by,max_per_action,wallet_id,state,provider_policy_id,owner_id,configuration_json) values($1,$2,'5000000',$3,'READY','test-policy','server-owner',$4)",
    [
      orgId,
      actors[0],
      walletId,
      JSON.stringify({
        organizationId: binding.organizationId,
        escrow: binding.escrow,
        maxPerAction: "5000000",
      }),
    ],
  );
  await pool.query(
    "insert into budget_controllers(id,organization_id,chain_id,address,owner_wallet_id,operator_wallet_id,asset,limit_projection_json) values($1,$2,'5042002',$3,$4,$5,$6,$7)",
    [
      controllerId,
      orgId,
      binding.address,
      walletId,
      operatorId,
      ARC_USDC,
      JSON.stringify({ escrow: binding.escrow, deploymentProof: { blockNumber: "1" } }),
    ],
  );
  await pool.query("insert into programs(id,organization_id,name) values($1,$2,'Owner program')", [
    programId,
    orgId,
  ]);
  await pool.query(
    "insert into bounty_drafts(id,program_id,policy_json,policy_hash,status,created_by,approved_by) values($1,$2,$3,$4,'APPROVED',$5,$5)",
    [draftId, programId, JSON.stringify(policy), hashPolicy(policy), actors[0]],
  );
  const commands: Record<OwnerCommand["kind"], OwnerCommand> = {
    DEPOSIT: { kind: "DEPOSIT", amount: "1000000" },
    WITHDRAW: { kind: "WITHDRAW", amount: "1000000" },
    SET_LIMITS: { kind: "SET_LIMITS", perAction: "1000000", daily: "3000000", interval: 120 },
    SET_ENABLED: { kind: "SET_ENABLED", enabled: true },
    APPROVE_POLICY: {
      kind: "APPROVE_POLICY",
      draftId,
      policyHash: hashPolicy(policy),
      reward: policy.reward,
      expiresAt: String(Math.floor(Date.now() / 1000) + 3600),
    },
  };
  const command = commands[kind];
  const prepare = (actor = 0, input: OwnerCommand = command) =>
    app.inject({
      method: "POST",
      url: `/api/v1/controllers/${controllerId}/owner-requests`,
      headers: headers(actor),
      payload: { command: input, authorizationWalletId: authorizerId },
    });
  const response = await prepare();
  expect(response.statusCode, response.body).toBe(201);
  const request = response.json();
  const authorize = async () => {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/owner-requests/${request.id}/authorize`,
      headers: { ...headers(), "if-match": String(request.version) },
      payload: {
        signature: await authorizer.signMessage({ message: request.authorization_message }),
      },
    });
    expect(response.statusCode).toBe(202);
  };
  const state: ControllerSnapshot = {
    blockNumber: 100n,
    blockHash: h(100),
    timestamp: BigInt(Math.floor(Date.now() / 1000)),
    enabled: false,
    perActionLimit: 1000000n,
    dailyLimit: 2000000n,
    minimumInterval: 60n,
    lastAllocation: 0n,
    spentToday: 0n,
    balance: 3000000n,
    operatorGasBalance: 1000000000000000000n,
    approval: { reward: 0n, expiresAt: 0n, consumed: false },
  };
  const controllerChain: BudgetChain = {
    read: vi.fn(async () => state),
    verifyDeployment: vi.fn(),
    finalReceipt: vi.fn(),
    findAllocation: vi.fn(),
  };
  let permission: OwnerPermission | null = null,
    loseBroadcast = false,
    failRestore = false,
    wrongEvent = false,
    wrongEnabledState = false,
    signFails = false;
  const provider: OwnerProvider = {
    verify: vi.fn(async () => {
      if (permission) throw new Error("Temporary permission is still active");
    }),
    setOwnerPermission: vi.fn(async (_w, _c, p) => {
      permission = p;
    }),
    restoreOwnerPermission: vi.fn(async () => {
      if (failRestore) {
        failRestore = false;
        throw new Error("Restore response lost");
      }
      permission = null;
    }),
    sign: vi.fn(async (_wallet, _key, tx) => {
      if (signFails) throw new Error("Signing unavailable");
      if (!permission || ownerCall(binding.address, permission.command).data !== tx.data)
        throw new Error("Missing exact owner permission");
      const serialized = await owner.signTransaction({
        chainId: 5042002,
        type: "legacy",
        to: tx.to,
        data:
          wrongEnabledState && command.kind === "SET_ENABLED"
            ? ownerCall(binding.address, { kind: "SET_ENABLED", enabled: !command.enabled }).data
            : tx.data,
        value: 0n,
        nonce: tx.nonce,
        gas: BigInt(tx.gasLimit),
        gasPrice: BigInt(tx.gasPrice),
      });
      return { serialized, hash: keccak256(serialized) };
    }),
  };
  const receipts = new Map<Hex, FundingReceipt>();
  function log(
    contract: Hex,
    topics: ReturnType<typeof encodeEventTopics>,
    data: Hex,
    hash: Hex,
    index = 0,
  ): Log {
    return {
      address: contract,
      topics: topics as [Hex, ...Hex[]],
      data,
      logIndex: index,
      transactionIndex: 0,
      transactionHash: hash,
      blockHash: h(100),
      blockNumber: 100n,
      removed: false,
    };
  }
  const chain: FundingChain = {
    balance: vi.fn(async () => 5000000n),
    prepare: vi.fn(async (_wallet, to, data) => ({
      to,
      data,
      nonce: 0,
      gasLimit: "0x186a0" as Hex,
      gasPrice: "0x1" as Hex,
    })),
    finalReceipt: vi.fn(async (hash) => receipts.get(hash) ?? null),
    broadcast: vi.fn(async (serialized) => {
      expect(permission).toBeNull();
      const hash = keccak256(serialized),
        tx = parseTransaction(serialized),
        value = wrongEvent ? 2n : 1000000n;
      expect(tx.data).toBe(ownerCall(binding.address, command).data);
      let logs: Log[];
      if (command.kind === "DEPOSIT")
        logs = [
          log(
            ARC_USDC,
            encodeEventTopics({
              abi: erc20Abi,
              eventName: "Transfer",
              args: { from: binding.owner, to: binding.address },
            }),
            encodeAbiParameters([{ type: "uint256" }], [value]),
            hash,
          ),
        ];
      else if (command.kind === "WITHDRAW")
        logs = [
          log(
            binding.address,
            encodeEventTopics({
              abi,
              eventName: "BudgetWithdrawn",
              args: { controller: binding.address },
            }),
            encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [binding.owner, value]),
            hash,
          ),
          log(
            ARC_USDC,
            encodeEventTopics({
              abi: erc20Abi,
              eventName: "Transfer",
              args: { from: binding.address, to: binding.owner },
            }),
            encodeAbiParameters([{ type: "uint256" }], [value]),
            hash,
            1,
          ),
        ];
      else if (command.kind === "APPROVE_POLICY")
        logs = [
          log(
            binding.address,
            encodeEventTopics({
              abi,
              eventName: "PolicyApproved",
              args: { controller: binding.address, policyHash: command.policyHash },
            }),
            encodeAbiParameters(
              [{ type: "uint256" }, { type: "uint64" }],
              [value, BigInt(command.expiresAt)],
            ),
            hash,
          ),
        ];
      else {
        const decoded = decodeFunctionData({ abi, data: tx.data as Hex });
        if (decoded.functionName === "setLimits") {
          state.perActionLimit = decoded.args[0];
          state.dailyLimit = decoded.args[1];
          state.minimumInterval = decoded.args[2];
        }
        if (decoded.functionName === "setEnabled") state.enabled = decoded.args[0];
        logs = [
          log(
            binding.address,
            encodeEventTopics({
              abi,
              eventName: "BudgetSettingsChanged",
              args: { controller: binding.address },
            }),
            encodeAbiParameters(
              [{ type: "bool" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
              [state.enabled, state.perActionLimit, state.dailyLimit, state.minimumInterval],
            ),
            hash,
          ),
        ];
      }
      receipts.set(hash, { hash, status: "success", blockHash: h(100), blockNumber: 100n, logs });
      if (loseBroadcast) {
        loseBroadcast = false;
        throw new Error("Broadcast response lost");
      }
      return hash;
    }),
  };
  const process = () =>
    processOwnerRequest(pool, provider, chain, controllerChain, identities, request.id);
  return {
    request,
    controllerId,
    orgId,
    walletId,
    command,
    binding,
    prepare,
    authorize,
    process,
    provider,
    chain,
    state,
    permission: () => permission,
    lose: () => {
      loseBroadcast = true;
    },
    failRestore: () => {
      failRestore = true;
    },
    wrongEvent: () => {
      wrongEvent = true;
    },
    signFails: () => {
      signFails = true;
    },
    changeEnabledState: () => {
      wrongEnabledState = true;
    },
  };
}

it.each(["SET_LIMITS", "SET_ENABLED", "APPROVE_POLICY", "DEPOSIT", "WITHDRAW"] as const)(
  "confirms the exact %s action and restores the base wallet policy",
  async (kind) => {
    const f = await fixture(kind);
    await f.authorize();
    expect(await f.process()).toMatchObject({ state: "COMPLETE" });
    expect(await f.process()).toEqual({ state: "COMPLETE" });
    expect(f.provider.sign).toHaveBeenCalledTimes(1);
    expect(f.chain.broadcast).toHaveBeenCalledTimes(1);
    expect(f.permission()).toBeNull();
    expect(
      (
        await pool.query(
          "select permission_pending,state,receipt_json from owner_requests where id=$1",
          [f.request.id],
        )
      ).rows[0],
    ).toMatchObject({
      permission_pending: false,
      state: "COMPLETE",
      receipt_json: { blockNumber: "100" },
    });
    if (kind === "APPROVE_POLICY")
      expect(
        (
          await pool.query("select count(*) from approved_allocations where controller_id=$1", [
            f.controllerId,
          ])
        ).rows[0].count,
      ).toBe("1");
    if (kind === "DEPOSIT" || kind === "WITHDRAW")
      expect(
        (
          await pool.query("select amount,category from receipts where organization_id=$1", [
            f.orgId,
          ])
        ).rows[0],
      ).toEqual({ amount: "1000000", category: `BUDGET_${kind}` });
  },
);
it("reconciles a lost broadcast response without another signature or transfer", async () => {
  const f = await fixture();
  await f.authorize();
  f.lose();
  await expect(f.process()).rejects.toThrow("Broadcast response lost");
  expect(await f.process()).toMatchObject({ state: "COMPLETE" });
  expect(f.provider.sign).toHaveBeenCalledTimes(1);
  expect(f.chain.broadcast).toHaveBeenCalledTimes(1);
  await expect(
    pool.query("update owner_requests set command_json='{}' where id=$1", [f.request.id]),
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    pool.query("update transaction_intents set sender_nonce=42 where wallet_id=$1", [f.walletId]),
  ).rejects.toMatchObject({ code: "23514" });
});
it("restores a pending permission before retry and checks a removed owner before broadcast", async () => {
  const f = await fixture();
  await f.authorize();
  f.failRestore();
  await expect(f.process()).rejects.toThrow("Restore response lost");
  expect(f.chain.broadcast).not.toHaveBeenCalled();
  expect(
    (await pool.query("select permission_pending from owner_requests where id=$1", [f.request.id]))
      .rows[0].permission_pending,
  ).toBe(true);
  await pool.query("update memberships set role='VIEWER' where organization_id=$1 and user_id=$2", [
    f.orgId,
    actors[0],
  ]);
  await expect(f.process()).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(f.permission()).toBeNull();
  expect(f.chain.broadcast).not.toHaveBeenCalled();
  expect(f.provider.sign).toHaveBeenCalledTimes(1);
});
it("removes a temporary permission when signing fails", async () => {
  const f = await fixture();
  await f.authorize();
  f.signFails();
  await expect(f.process()).rejects.toThrow("Signing unavailable");
  expect(f.permission()).toBeNull();
  expect(f.chain.broadcast).not.toHaveBeenCalled();
});
it("rejects a signed enabled state that differs from the owner confirmation", async () => {
  const f = await fixture("SET_ENABLED");
  await f.authorize();
  f.changeEnabledState();
  await expect(f.process()).rejects.toMatchObject({ code: "OWNER_SIGNATURE_MISMATCH" });
  expect(f.chain.broadcast).not.toHaveBeenCalled();
  expect(f.permission()).toBeNull();
  await expect(
    pool.query("update owner_requests set command_json=$2 where id=$1", [
      f.request.id,
      JSON.stringify({ kind: "SET_ENABLED", enabled: false }),
    ]),
  ).rejects.toMatchObject({ code: "23514" });
});
it("cancels a queued action before any permission or signature exists", async () => {
  const f = await fixture();
  await f.authorize();
  const result = await app.inject({
    method: "POST",
    url: `/api/v1/owner-requests/${f.request.id}/cancel`,
    headers: headers(),
    payload: {},
  });
  expect(result.statusCode).toBe(200);
  expect(await f.process()).toEqual({ state: "CANCELLED" });
  expect(f.provider.setOwnerPermission).not.toHaveBeenCalled();
  expect(f.provider.sign).not.toHaveBeenCalled();
});
it("rejects changed reward events and records no deposit receipt", async () => {
  const f = await fixture();
  await f.authorize();
  f.wrongEvent();
  await expect(f.process()).rejects.toMatchObject({ code: "OWNER_EVENT_MISMATCH" });
  expect(
    (await pool.query("select count(*) from receipts where organization_id=$1", [f.orgId])).rows[0]
      .count,
  ).toBe("0");
});
it("requires an owner and a currently linked confirmation wallet", async () => {
  const f = await fixture();
  expect((await f.prepare(1)).statusCode).toBe(403);
  await f.authorize();
  linked = false;
  await expect(f.process()).rejects.toMatchObject({ code: "AUTHORIZER_NOT_LINKED" });
  expect(f.provider.setOwnerPermission).not.toHaveBeenCalled();
  linked = true;
});
it("cancels an unconfirmed action without a signing job", async () => {
  const f = await fixture();
  expect(
    (
      await app.inject({
        method: "POST",
        url: `/api/v1/owner-requests/${f.request.id}/cancel`,
        headers: headers(),
        payload: {},
      })
    ).statusCode,
  ).toBe(200);
  expect(await f.process()).toEqual({ state: "CANCELLED" });
  expect(f.provider.sign).not.toHaveBeenCalled();
  expect(
    (await pool.query("select count(*) from outbox where aggregate_id=$1", [f.orgId])).rows[0]
      .count,
  ).toBe("0");
});
it("uses the same wallet lock as direct bounty funding", async () => {
  const f = await fixture();
  await f.authorize();
  const c = await pool.connect(),
    lock = `treasury-wallet:${f.walletId}`;
  try {
    await c.query("select pg_advisory_lock(hashtextextended($1,0))", [lock]);
    await expect(f.process()).rejects.toThrow("Another action");
    expect(f.provider.sign).not.toHaveBeenCalled();
  } finally {
    await c.query("select pg_advisory_unlock(hashtextextended($1,0))", [lock]);
    c.release();
  }
});
