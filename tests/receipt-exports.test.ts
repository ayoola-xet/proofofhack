import { randomBytes, randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { PgBoss } from "pg-boss";
import { encodeAbiParameters, encodeEventTopics, type Hex } from "viem";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { bountyEscrowAbi } from "../packages/chain/src/abi/BountyEscrow.ts";
import { ARC_USDC } from "../packages/chain/src/arc.ts";
import type { FundingReceipt } from "../packages/chain/src/funding.ts";
import { hashCanonical } from "../packages/crypto-envelope/src/index.ts";
import { connectDatabase, databaseUrl } from "../packages/database/src/index.ts";
import { hashPolicy, organizationHash } from "../packages/domain/src/index.ts";
import { createApp } from "../services/api/src/app.ts";
import { LocalAuthProvider } from "../services/api/src/auth.ts";
import { processReceiptExport } from "../services/receipts/src/process.ts";
import { contentHash, exportSnapshotSchema, receiptCsv } from "../services/receipts/src/records.ts";
import { startReceiptExportJobs } from "../services/worker/src/receipt-jobs.ts";
import { a, examplePolicy, h } from "./helpers/policy.ts";

const admin = connectDatabase().pool,
  name = `exports_test_${randomUUID().replaceAll("-", "")}`,
  url = new URL(databaseUrl());
url.pathname = `/${name}`;
const { pool, db } = connectDatabase(url.toString());
const identities = Array.from({ length: 4 }, (_, i) => ({
  subject: `local:test:${randomUUID()}`,
  token: randomBytes(32).toString("hex"),
  displayName: `Export tester ${i}`,
}));
const app = await createApp({
  pool,
  auth: new LocalAuthProvider(identities, "local"),
  appEnv: "local",
  webOrigin: "http://localhost:5173",
});
const users: string[] = [],
  chainReceipts = new Map<Hex, FundingReceipt>();
const chain = { finalReceipt: vi.fn(async (hash: Hex) => chainReceipts.get(hash) ?? null) };
const headers = (actor = 0, key = randomUUID()) => ({
  authorization: `Bearer ${identities[actor].token}`,
  "idempotency-key": key,
});

it("Rejects a local receipt asset in the live API configuration", async () => {
  await expect(
    createApp({
      pool,
      auth: new LocalAuthProvider(identities, "local"),
      appEnv: "arc-testnet",
      webOrigin: "https://example.invalid",
      localReceiptAsset: a(99),
    }),
  ).rejects.toThrow("Local receipt assets require a local environment.");
});

it("Rejects other receipt chains and assets at the API and worker boundaries", async () => {
  for (const changed of [
    { chainId: "31337", asset: ARC_USDC },
    { chainId: "5042002", asset: a(99) },
  ]) {
    const f = await fixture();
    await f.add();
    const created = await f.create();
    expect(created.statusCode).toBe(202);
    const row = (await pool.query("select * from receipt_exports where id=$1", [created.json().id]))
      .rows[0];
    const snapshot = {
      ...row.snapshot_json,
      records: row.snapshot_json.records.map((r: Record<string, unknown>) => ({
        ...r,
        ...changed,
      })),
    };
    const id = randomUUID();
    await pool.query(
      "insert into receipt_exports(id,organization_id,requested_by,snapshot_json,input_hash) values($1,$2,$3,$4,$5)",
      [id, f.org, users[0], snapshot, hashCanonical(snapshot)],
    );
    const calls = chain.finalReceipt.mock.calls.length;
    await processReceiptExport(pool, chain, id);
    expect(chain.finalReceipt.mock.calls.length).toBe(calls);
    expect(
      (await pool.query("select state,error_code from receipt_exports where id=$1", [id])).rows[0],
    ).toMatchObject({ state: "FAILED", error_code: "EXPORT_SCOPE_MISMATCH" });
    if (changed.chainId === "31337")
      await pool.query(
        "update chain_events set chain_id='31337' where id in (select event_id from receipts where organization_id=$1)",
        [f.org],
      );
    else
      await pool.query("update receipts set asset=$2 where organization_id=$1", [
        f.org,
        changed.asset,
      ]);
    const rejected = await f.create();
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json().error.code).toBe("EXPORT_SCOPE_MISMATCH");
  }
});
let seq = 100;
let boss: PgBoss | undefined;
beforeAll(async () => {
  await admin.query(`create database ${name}`);
  await migrate(db, { migrationsFolder: "packages/database/migrations" });
  for (let i = 0; i < 4; i++)
    users.push((await app.inject({ url: "/api/v1/me", headers: headers(i) })).json().user.id);
});
afterAll(async () => {
  await boss?.stop({ graceful: true });
  await app.close();
  await pool.end();
  await admin.query(`drop database ${name}`);
  await admin.end();
});
async function fixture() {
  const org = randomUUID(),
    program = randomUUID();
  await pool.query(
    "insert into organizations(id,onchain_id,name,owner_user_id) values($1,$2,'Exports',$3)",
    [org, organizationHash(org), users[0]],
  );
  for (const [i, role] of [
    [0, "OWNER"],
    [1, "TREASURY"],
    [3, "REVIEWER"],
  ] as const)
    await pool.query("insert into memberships(organization_id,user_id,role) values($1,$2,$3)", [
      org,
      users[i],
      role,
    ]);
  await pool.query("insert into programs(id,organization_id,name) values($1,$2,'Receipts')", [
    program,
    org,
  ]);
  const add = async (amount = "1000001", status = "FINAL") => {
    const n = seq++,
      policy = {
        ...examplePolicy(),
        settlementChainId: "5042002",
        asset: ARC_USDC,
        organizationId: organizationHash(org),
        organizationNonce: h(n),
        reward: amount,
      },
      bounty = hashPolicy(policy),
      hash = h(n),
      blockHash = h(n + 10000),
      eventId = randomUUID();
    const args = {
      bountyId: bounty,
      policyHash: bounty,
      organizationId: policy.organizationId,
      asset: ARC_USDC,
      reward: BigInt(amount),
    };
    const entry = bountyEscrowAbi.find((e) => e.type === "event" && e.name === "BountyFunded");
    if (entry?.type !== "event") throw new Error("No funding event");
    const nonIndexed = entry.inputs.filter((i) => !i.indexed);
    const receipt: FundingReceipt = {
      hash,
      blockHash,
      blockNumber: BigInt(n),
      status: "success",
      logs: [
        {
          address: policy.escrow,
          topics: encodeEventTopics({ abi: bountyEscrowAbi, eventName: "BountyFunded", args }) as [
            Hex,
            ...Hex[],
          ],
          data: encodeAbiParameters(nonIndexed, nonIndexed.map((i) => args[i.name]) as never),
          blockHash,
          blockNumber: BigInt(n),
          transactionHash: hash,
          transactionIndex: 0,
          logIndex: 0,
          removed: false,
        },
      ],
    };
    chainReceipts.set(hash, receipt);
    await pool.query(
      "insert into bounties(bounty_id,policy_hash,program_id,policy_json,chain_id,escrow,reward,unallocated_reward,chain_state,creation_tx) values($1,$1,$2,$3,'5042002',$4,$5,$5,'FUNDED',$6)",
      [bounty, program, policy, policy.escrow, amount, hash],
    );
    await pool.query(
      "insert into chain_events(id,chain_id,contract_address,transaction_hash,log_index,block_number,block_hash,name,payload_json,finality_state) values($1,'5042002',$2,$3,0,$4,$5,'BountyFunded',$6,$7)",
      [eventId, policy.escrow, hash, String(n), blockHash, { ...args, reward: amount }, status],
    );
    const id = (
      await pool.query(
        "insert into receipts(organization_id,bounty_id,category,amount,asset,event_id,status) values($1,$2,'FUNDING',$3,$4,$5,$6) returning id",
        [org, bounty, amount, ARC_USDC, eventId, status],
      )
    ).rows[0].id;
    return { id, eventId, hash, receipt, bounty, policy };
  };
  const create = async (body = {}, actor = 0, key = randomUUID()) =>
    app.inject({
      method: "POST",
      url: `/api/v1/organizations/${org}/receipt-exports`,
      headers: headers(actor, key),
      payload: body,
    });
  return { org, program, add, create };
}
it("Saves one snapshot for duplicate requests and exports exact large amounts and final event references", async () => {
  const f = await fixture(),
    r = await f.add("9007199254740993123456"),
    key = randomUUID();
  const responses = await Promise.all(Array.from({ length: 4 }, () => f.create({}, 0, key)));
  expect(responses.map((r) => r.statusCode)).toEqual([202, 202, 202, 202]);
  const id = responses[0].json().id;
  expect(new Set(responses.map((r) => r.json().id)).size).toBe(1);
  expect((await app.inject({ url: `/api/v1/exports/${id}`, headers: headers() })).statusCode).toBe(
    202,
  );
  await f.add();
  await processReceiptExport(pool, chain, id);
  const download = await app.inject({ url: `/api/v1/exports/${id}`, headers: headers() });
  expect(download.statusCode).toBe(200);
  expect(download.body).toContain('"9007199254740993123456","9007199254740993.123456"');
  expect(download.body).toContain(r.hash);
  expect(download.body).toContain('"Arc Testnet"');
  expect(download.body).toContain('"FIXTURE_ONLY","TRUSTED_SERVICE"');
  expect(download.body.split("\r\n")).toHaveLength(3);
  expect(download.headers["x-content-sha256"]).toBe(contentHash(download.body));
  expect(download.headers["cache-control"]).toBe("no-store");
  await expect(
    pool.query("update receipt_exports set snapshot_json='{}' where id=$1", [id]),
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    pool.query("update receipt_exports set csv='changed' where id=$1", [id]),
  ).rejects.toMatchObject({ code: "23514" });
  await processReceiptExport(pool, chain, id);
  expect((await app.inject({ url: `/api/v1/exports/${id}`, headers: headers() })).body).toBe(
    download.body,
  );
});
it("Requires current roles and keeps an export private to its requester", async () => {
  const f = await fixture();
  await f.add();
  expect((await f.create({}, 3)).statusCode).toBe(403);
  expect((await f.create({}, 2)).statusCode).toBe(404);
  const id = (await f.create()).json().id;
  await processReceiptExport(pool, chain, id);
  for (const actor of [1, 2])
    expect(
      (await app.inject({ url: `/api/v1/exports/${id}`, headers: headers(actor) })).statusCode,
    ).toBe(404);
  await pool.query(
    "update memberships set role='REVIEWER' where organization_id=$1 and user_id=$2",
    [f.org, users[0]],
  );
  for (const suffix of ["", "/status"])
    expect(
      (await app.inject({ url: `/api/v1/exports/${id}${suffix}`, headers: headers() })).statusCode,
    ).toBe(403);
});
it("Cancels pending work if the requester loses membership", async () => {
  const f = await fixture();
  await f.add();
  const id = (await f.create()).json().id;
  await pool.query(
    "update memberships set status='REMOVED' where organization_id=$1 and user_id=$2",
    [f.org, users[0]],
  );
  await processReceiptExport(pool, chain, id);
  expect(
    (await pool.query("select state,csv from receipt_exports where id=$1", [id])).rows[0],
  ).toEqual({ state: "CANCELLED", csv: null });
});
it("Rejects changed event amounts and block hashes without producing a file", async () => {
  for (const change of ["amount", "block"]) {
    const f = await fixture(),
      r = await f.add();
    if (change === "amount")
      await pool.query("update receipts set amount='999' where id=$1", [r.id]);
    const id = (await f.create()).json().id;
    if (change === "block") chainReceipts.set(r.hash, { ...r.receipt, blockHash: h(9999) });
    await processReceiptExport(pool, chain, id);
    expect(
      (await pool.query("select state,csv,error_code from receipt_exports where id=$1", [id]))
        .rows[0],
    ).toEqual({ state: "FAILED", csv: null, error_code: "EXPORT_EVENT_MISMATCH" });
  }
});
it("Retries incomplete finality and stops after five failed checks", async () => {
  const f = await fixture(),
    r = await f.add(),
    id = (await f.create()).json().id;
  chainReceipts.delete(r.hash);
  await processReceiptExport(pool, chain, id);
  expect(
    (await pool.query("select state from receipt_exports where id=$1", [id])).rows[0].state,
  ).toBe("RETRYING");
  chainReceipts.set(r.hash, r.receipt);
  await processReceiptExport(pool, chain, id);
  expect(
    (await pool.query("select state from receipt_exports where id=$1", [id])).rows[0].state,
  ).toBe("READY");
  const failed = (await f.create()).json().id;
  chainReceipts.delete(r.hash);
  for (let i = 0; i < 6; i++) await processReceiptExport(pool, chain, failed);
  expect(
    (await pool.query("select state,attempts,csv from receipt_exports where id=$1", [failed]))
      .rows[0],
  ).toEqual({ state: "FAILED", attempts: 5, csv: null });
});
it("Applies category and date filters and excludes non-final rows", async () => {
  const f = await fixture();
  await f.add();
  await f.add("1000001", "PENDING");
  expect((await f.create({ category: "REFUND" })).json().rowCount).toBe(0);
  expect((await f.create()).json().rowCount).toBe(1);
  expect((await f.create({ from: "2099-01-01T00:00:00.000Z" })).json().rowCount).toBe(0);
  for (const payload of [
    { category: "INVALID" },
    { from: "bad" },
    { from: "2030-01-01T00:00:00.000Z", to: "2020-01-01T00:00:00.000Z" },
    { extra: true },
  ])
    expect((await f.create(payload)).statusCode).toBe(400);
  const list = await app.inject({
    url: `/api/v1/organizations/${f.org}/receipts?category=FUNDING&limit=1`,
    headers: headers(),
  });
  expect(list.json().items).toHaveLength(1);
  expect(list.json().nextCursor).toBeTruthy();
});
async function paymentFixture(actor: number) {
  const f = await fixture(),
    funded = await f.add(),
    n = seq++;
  const claimant = a(n),
    claimId = h(n + 20000),
    wallet = randomUUID(),
    upload = randomUUID();
  await pool.query(
    "insert into wallets(id,provider,provider_wallet_id,owner_type,owner_id,chain_id,address) values($1,'PRIVY',$2,'USER',$3,'5042002',$4)",
    [wallet, randomUUID(), users[actor], claimant],
  );
  await pool.query(
    "insert into uploads(id,owner_user_id,bounty_id,object_key,ciphertext_hash,key_id,byte_length,state,expires_at) values($1,$2,$3,$4,$5,'test-key',10,'COMPLETE',now()+interval '1 hour')",
    [upload, users[actor], funded.bounty, randomUUID(), h(n)],
  );
  await pool.query(
    "insert into claims(claim_id,bounty_id,researcher_user_id,claimant_wallet_id,claimant_address,upload_id,evidence_commitment,job_state) values($1,$2,$3,$4,$5,$6,$7,'SETTLED')",
    [claimId, funded.bounty, users[actor], wallet, claimant, upload, h(n)],
  );
  const event = bountyEscrowAbi.find((e) => e.type === "event" && e.name === "Paid");
  if (event?.type !== "event") throw new Error("No payment event");
  const args = { bountyId: funded.bounty, claimId, claimant, asset: ARC_USDC, amount: 1000001n };
  const hash = h(n),
    blockHash = h(n + 10000),
    eventId = randomUUID();
  const receipt: FundingReceipt = {
    hash,
    blockHash,
    blockNumber: BigInt(n),
    status: "success",
    logs: [
      {
        address: funded.policy.escrow,
        topics: encodeEventTopics({ abi: bountyEscrowAbi, eventName: "Paid", args }) as [
          Hex,
          ...Hex[],
        ],
        data: encodeAbiParameters(
          event.inputs.filter((i) => !i.indexed),
          [claimant, ARC_USDC, args.amount],
        ),
        blockHash,
        blockNumber: BigInt(n),
        transactionHash: hash,
        transactionIndex: 0,
        logIndex: 0,
        removed: false,
      },
    ],
  };
  chainReceipts.set(hash, receipt);
  await pool.query(
    "insert into chain_events(id,chain_id,contract_address,transaction_hash,log_index,block_number,block_hash,name,payload_json,finality_state) values($1,'5042002',$2,$3,0,$4,$5,'Paid',$6,'FINAL')",
    [
      eventId,
      funded.policy.escrow,
      hash,
      String(n),
      blockHash,
      { ...args, amount: String(args.amount) },
    ],
  );
  const row = (
    await pool.query(
      "insert into receipts(organization_id,claimant_user_id,bounty_id,category,amount,asset,event_id,status) values($1,$2,$3,'PAYMENT','1000001',$4,$5,'FINAL') returning id",
      [f.org, users[actor], funded.bounty, ARC_USDC, eventId],
    )
  ).rows[0];
  return { ...f, receiptId: row.id, claimId, hash };
}
it("Exports only the researcher's own payments without organization membership", async () => {
  const own = await paymentFixture(2),
    other = await paymentFixture(1);
  const list = (await app.inject({ url: "/api/v1/me/receipts", headers: headers(2) })).json();
  expect(list.items.map((r: { id: string }) => r.id)).toEqual([own.receiptId]);
  const key = randomUUID();
  const create = () =>
    app.inject({
      method: "POST",
      url: "/api/v1/me/receipt-exports",
      headers: headers(2, key),
      payload: {},
    });
  const response = await create();
  expect(response.statusCode).toBe(202);
  expect(response.json().rowCount).toBe(1);
  const id = response.json().id;
  expect((await create()).json().id).toBe(id);
  await processReceiptExport(pool, chain, id);
  const download = await app.inject({ url: `/api/v1/exports/${id}`, headers: headers(2) });
  expect(download.statusCode).toBe(200);
  expect(download.body).toContain(own.hash);
  expect(download.body).not.toContain(other.hash);
  expect(download.body).toContain('"PAYMENT","1000001","1.000001"');
  for (const actor of [0, 1, 3])
    expect(
      (await app.inject({ url: `/api/v1/exports/${id}`, headers: headers(actor) })).statusCode,
    ).toBe(404);
  expect(
    (await app.inject({ url: "/api/v1/me/receipt-exports", headers: headers(2) }))
      .json()
      .items.map((e: { id: string }) => e.id),
  ).toContain(id);
  expect(
    (
      await app.inject({
        url: `/api/v1/organizations/${own.org}/receipt-exports`,
        headers: headers(0),
      })
    ).json().items,
  ).toEqual([]);
  await expect(
    pool.query("update receipt_exports set organization_id=$2 where id=$1", [id, own.org]),
  ).rejects.toMatchObject({ code: "23514" });
});
it("Preserves personal payment access after organization removal and rejects a wrong claimant binding", async () => {
  const own = await paymentFixture(3);
  const create = () =>
    app.inject({
      method: "POST",
      url: "/api/v1/me/receipt-exports",
      headers: headers(3),
      payload: {},
    });
  const id = (await create()).json().id;
  await pool.query(
    "update memberships set status='REMOVED' where organization_id=$1 and user_id=$2",
    [own.org, users[3]],
  );
  await processReceiptExport(pool, chain, id);
  expect((await app.inject({ url: `/api/v1/exports/${id}`, headers: headers(3) })).statusCode).toBe(
    200,
  );
  await pool.query("update receipts set claimant_user_id=$2 where id=$1", [
    own.receiptId,
    users[0],
  ]);
  const bad = await app.inject({
    method: "POST",
    url: "/api/v1/me/receipt-exports",
    headers: headers(0),
    payload: {},
  });
  expect(bad.json().error.code).toBe("EXPORT_SCOPE_MISMATCH");
});
it("Processes a durable export through the actual PostgreSQL queue", async () => {
  const f = await fixture();
  await f.add();
  const id = (await f.create()).json().id;
  boss = new PgBoss(url.toString());
  boss.on("error", () => {});
  await boss.start();
  await startReceiptExportJobs(boss, pool, chain);
  let state = "";
  for (let i = 0; i < 100; i++) {
    state = (await pool.query("select state from receipt_exports where id=$1", [id])).rows[0].state;
    if (state === "READY") break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  expect(state).toBe("READY");
  const saved = (
    await pool.query("select snapshot_json,csv from receipt_exports where id=$1", [id])
  ).rows[0];
  expect(saved.csv).toBe(receiptCsv(exportSnapshotSchema.parse(saved.snapshot_json).records));
}, 15000);
