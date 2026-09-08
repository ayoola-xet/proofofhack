import { randomBytes, randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import Fastify from "fastify";
import {
  encodeAbiParameters,
  encodeEventTopics,
  erc20Abi,
  type Hex,
  keccak256,
  type Log,
  parseTransaction,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { z } from "zod";
import { bountyEscrowAbi } from "../packages/chain/src/abi/BountyEscrow.ts";
import { ARC_USDC } from "../packages/chain/src/arc.ts";
import type { FundingChain, FundingReceipt } from "../packages/chain/src/funding.ts";
import { connectDatabase, databaseUrl } from "../packages/database/src/index.ts";
import { DomainError, hashPolicy } from "../packages/domain/src/index.ts";
import type { TreasuryProvider } from "../packages/privy/src/treasury.ts";
import { registerFundingRoutes } from "../services/api/src/funding-routes.ts";
import { fundBounty } from "../services/treasury/src/fund.ts";
import { a, examplePolicy, h } from "./helpers/policy.ts";

const admin = connectDatabase().pool;
const databaseName = `funding_test_${randomUUID().replaceAll("-", "")}`;
const url = new URL(databaseUrl());
url.pathname = `/${databaseName}`;
const { db, pool } = connectDatabase(url.toString());
const actors = [randomUUID(), randomUUID()];
const userAccount = privateKeyToAccount(`0x${randomBytes(32).toString("hex")}` as Hex);
const userWalletId = randomUUID();
const app = Fastify();
app.decorateRequest("actor");
app.addHook("onRequest", async (req) => {
  req.actor = { id: actors[Number(req.headers["test-actor"] ?? 0)], displayName: "Test" };
});
app.setErrorHandler((error, _req, reply) =>
  reply
    .code(error instanceof DomainError ? error.status : error instanceof z.ZodError ? 400 : 500)
    .send({ message: error instanceof Error ? error.message : "Test error" }),
);
registerFundingRoutes(app, pool, a(1), {
  userWallets: async () => [
    { providerWalletId: userWalletId, address: userAccount.address.toLowerCase() },
  ],
});
beforeAll(async () => {
  await admin.query(`create database ${databaseName}`);
  await migrate(db, { migrationsFolder: "packages/database/migrations" });
  for (const id of actors)
    await pool.query(
      "insert into users(id,privy_user_id,display_name) values($1::uuid,$1::text,'Funding test')",
      [id],
    );
  await pool.query(
    "insert into wallets(id,provider,provider_wallet_id,owner_type,owner_id,chain_id,address) values($1::uuid,'PRIVY',$1::text,'USER',$2,'5042002',$3)",
    [userWalletId, actors[0], userAccount.address.toLowerCase()],
  );
});
afterAll(async () => {
  await app.close();
  await pool.end();
  await admin.query(`drop database if exists ${databaseName}`);
  await admin.end();
});
function headers(actor = 0) {
  return { "test-actor": String(actor), "idempotency-key": randomUUID() };
}
async function fixture() {
  const treasury = privateKeyToAccount(`0x${randomBytes(32).toString("hex")}` as Hex);
  const orgId = randomUUID(),
    walletId = randomUUID(),
    programId = randomUUID(),
    draftId = randomUUID();
  const policy = {
    ...examplePolicy(),
    settlementChainId: "5042002",
    organizationId: keccak256(`0x${orgId.replaceAll("-", "")}`),
    refundRecipient: treasury.address.toLowerCase() as Hex,
    asset: ARC_USDC,
    reward: "1000000",
    submissionDeadline: String(Math.floor(Date.now() / 1000) + 3600),
    settlementDeadline: String(Math.floor(Date.now() / 1000) + 7200),
  };
  await pool.query(
    "insert into organizations(id,onchain_id,name,owner_user_id) values($1,$2,'Funding test',$3)",
    [orgId, policy.organizationId, actors[0]],
  );
  await pool.query(
    "insert into memberships(organization_id,user_id,role) values($1,$2,'OWNER'),($1,$3,'VIEWER')",
    [orgId, actors[0], actors[1]],
  );
  await pool.query(
    "insert into wallets(id,provider,provider_wallet_id,owner_type,owner_id,chain_id,address) values($1::uuid,'PRIVY',$1::text,'ORGANIZATION',$2,'5042002',$3)",
    [walletId, orgId, policy.refundRecipient],
  );
  await pool.query(
    "insert into wallet_setups(organization_id,requested_by,max_per_action,wallet_id,state,provider_policy_id,owner_id,configuration_json) values($1,$2,'5000000',$3,'READY','test-policy','test-owner',$4)",
    [
      orgId,
      actors[0],
      walletId,
      JSON.stringify({
        organizationId: policy.organizationId,
        escrow: policy.escrow,
        maxPerAction: "5000000",
      }),
    ],
  );
  await pool.query(
    "insert into programs(id,organization_id,name) values($1,$2,'Funding program')",
    [programId, orgId],
  );
  await pool.query(
    "insert into bounty_drafts(id,program_id,policy_json,policy_hash,created_by,approved_by,status) values($1,$2,$3,$4,$5,$5,'APPROVED')",
    [draftId, programId, JSON.stringify(policy), hashPolicy(policy), actors[0]],
  );
  const prepare = () =>
    app.inject({
      method: "POST",
      url: `/api/v1/bounty-drafts/${draftId}/funding-requests`,
      headers: headers(),
      payload: { policyHash: hashPolicy(policy), walletId, authorizationWalletId: userWalletId },
    });
  const response = await prepare();
  expect(response.statusCode).toBe(201);
  const funding = response.json();
  async function authorize() {
    const signature = await userAccount.signMessage({ message: funding.authorization_message });
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/funding-requests/${funding.id}/authorize`,
      headers: { ...headers(), "if-match": "1" },
      payload: { signature },
    });
    expect(response.statusCode).toBe(202);
  }
  const receipts = new Map<Hex, FundingReceipt>();
  let loseResponse = false,
    wrongEvent = false;
  const provider: TreasuryProvider = {
    createPolicy: vi.fn(),
    createWallet: vi.fn(),
    verify: vi.fn(async () => {}),
    sign: vi.fn(async (_wallet, _key, tx) => {
      const serialized = await treasury.signTransaction({
        chainId: 5042002,
        to: tx.to,
        data: tx.data,
        nonce: tx.nonce,
        type: "legacy",
        value: 0n,
        gas: BigInt(tx.gasLimit),
        gasPrice: BigInt(tx.gasPrice),
      });
      return { serialized, hash: keccak256(serialized) };
    }),
  };
  function log(
    address: Hex,
    topics: ReturnType<typeof encodeEventTopics>,
    data: Hex,
    index: number,
    hash: Hex,
  ): Log {
    return {
      address,
      topics: topics as [Hex, ...Hex[]],
      data,
      logIndex: index,
      transactionIndex: 0,
      transactionHash: hash,
      blockHash: h(10),
      blockNumber: 100n,
      removed: false,
    };
  }
  const chain: FundingChain = {
    balance: vi.fn(async () => 10000000n),
    prepare: vi.fn(async (_wallet, to, data) => ({
      to,
      data,
      nonce: receipts.size,
      gasLimit: "0x186a0" as Hex,
      gasPrice: "0x1" as Hex,
    })),
    finalReceipt: vi.fn(async (hash) => receipts.get(hash) ?? null),
    broadcast: vi.fn(async (serialized) => {
      const hash = keccak256(serialized),
        tx = parseTransaction(serialized);
      const value = wrongEvent ? 2n : BigInt(policy.reward);
      const logs =
        tx.to?.toLowerCase() === ARC_USDC
          ? [
              log(
                ARC_USDC,
                encodeEventTopics({
                  abi: erc20Abi,
                  eventName: "Approval",
                  args: { owner: treasury.address, spender: policy.escrow },
                }),
                encodeAbiParameters([{ type: "uint256" }], [BigInt(policy.reward)]),
                0,
                hash,
              ),
            ]
          : [
              log(
                policy.escrow,
                encodeEventTopics({
                  abi: bountyEscrowAbi,
                  eventName: "BountyFunded",
                  args: { bountyId: hashPolicy(policy), organizationId: policy.organizationId },
                }),
                encodeAbiParameters(
                  [{ type: "uint256" }, { type: "address" }, { type: "bytes32" }],
                  [value, ARC_USDC, hashPolicy(policy)],
                ),
                0,
                hash,
              ),
              log(
                ARC_USDC,
                encodeEventTopics({
                  abi: erc20Abi,
                  eventName: "Transfer",
                  args: { from: treasury.address, to: policy.escrow },
                }),
                encodeAbiParameters([{ type: "uint256" }], [BigInt(policy.reward)]),
                1,
                hash,
              ),
            ];
      receipts.set(hash, { hash, blockHash: h(10), blockNumber: 100n, status: "success", logs });
      if (loseResponse) {
        loseResponse = false;
        throw new Error("Accepted transaction response lost");
      }
      return hash;
    }),
  };
  return {
    orgId,
    walletId,
    policy,
    funding,
    provider,
    chain,
    prepare,
    authorize,
    loseNextResponse: () => {
      loseResponse = true;
    },
    wrongFundingEvent: () => {
      wrongEvent = true;
    },
  };
}
it("Requires the exact wallet confirmation and creates no job when cancelled", async () => {
  const f = await fixture();
  const bad = await userAccount.signMessage({ message: "Different request" });
  expect(
    (
      await app.inject({
        method: "POST",
        url: `/api/v1/funding-requests/${f.funding.id}/authorize`,
        headers: { ...headers(), "if-match": "1" },
        payload: { signature: bad },
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        method: "POST",
        url: `/api/v1/funding-requests/${f.funding.id}/cancel`,
        headers: headers(),
        payload: {},
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (await pool.query("select count(*) from outbox where aggregate_id=$1", [f.orgId])).rows[0]
      .count,
  ).toBe("0");
  expect(await fundBounty(pool, f.provider, f.chain, f.funding.id)).toEqual({ state: "CANCELLED" });
  expect(f.provider.sign).not.toHaveBeenCalled();
  expect((await f.prepare()).statusCode).toBe(201);
});
it("Reconciles a lost broadcast response without signing or funding twice", async () => {
  const f = await fixture();
  await f.authorize();
  f.loseNextResponse();
  await expect(fundBounty(pool, f.provider, f.chain, f.funding.id)).rejects.toThrow(
    "response lost",
  );
  const saved = (
    await pool.query(
      "select t.state,t.transaction_hash,s.transaction_hash as saved_hash from transaction_intents t join signed_transactions s on s.intent_id=t.id where t.wallet_id=$1",
      [f.walletId],
    )
  ).rows[0];
  expect(saved.state).toBe("SUBMITTED");
  expect(saved.transaction_hash).toBe(saved.saved_hash);
  const retry = {
    method: "POST" as const,
    url: `/api/v1/funding-requests/${f.funding.id}/retry`,
    headers: headers(),
    payload: {},
  };
  expect((await app.inject({ ...retry, headers: headers(1) })).statusCode).toBe(403);
  const retried = await app.inject(retry);
  expect(retried.statusCode).toBe(202);
  expect((await app.inject(retry)).json().version).toBe(retried.json().version);
  expect(
    (
      await pool.query(
        "select count(*) from outbox where aggregate_id=$1 and event_type='BOUNTY_FUNDING'",
        [f.orgId],
      )
    ).rows[0].count,
  ).toBe("2");
  expect(await fundBounty(pool, f.provider, f.chain, f.funding.id)).toMatchObject({
    state: "FUNDED",
  });
  expect(await fundBounty(pool, f.provider, f.chain, f.funding.id)).toEqual({ state: "FUNDED" });
  expect(f.provider.sign).toHaveBeenCalledTimes(2);
  expect(f.chain.broadcast).toHaveBeenCalledTimes(2);
  await expect(
    pool.query("update funding_requests set authorization_message='changed' where id=$1", [
      f.funding.id,
    ]),
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    pool.query("update transaction_intents set sender_nonce=999 where wallet_id=$1", [f.walletId]),
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    pool.query(
      "update signed_transactions set serialized='0x00' where intent_id in(select id from transaction_intents where wallet_id=$1)",
      [f.walletId],
    ),
  ).rejects.toMatchObject({ code: "23514" });
  expect(
    (await pool.query("select count(*) from receipts where organization_id=$1", [f.orgId])).rows[0]
      .count,
  ).toBe("1");
  expect(
    (
      await pool.query("select chain_state,unallocated_reward from bounties where bounty_id=$1", [
        hashPolicy(f.policy),
      ])
    ).rows[0],
  ).toEqual({ chain_state: "FUNDED", unallocated_reward: "1000000" });
});
it("Rejects a final receipt whose funding amount differs from the approved reward", async () => {
  const f = await fixture();
  await f.authorize();
  f.wrongFundingEvent();
  await expect(fundBounty(pool, f.provider, f.chain, f.funding.id)).rejects.toMatchObject({
    code: "FUNDING_EVENT_MISMATCH",
  });
  expect(
    (await pool.query("select count(*) from bounties where bounty_id=$1", [hashPolicy(f.policy)]))
      .rows[0].count,
  ).toBe("0");
});
it("Checks the current role again before signing or broadcasting", async () => {
  const f = await fixture();
  await f.authorize();
  await pool.query("update memberships set role='VIEWER' where organization_id=$1 and user_id=$2", [
    f.orgId,
    actors[0],
  ]);
  await expect(fundBounty(pool, f.provider, f.chain, f.funding.id)).rejects.toMatchObject({
    status: 403,
  });
  expect(f.provider.sign).not.toHaveBeenCalled();
  expect(f.chain.broadcast).not.toHaveBeenCalled();
});
