import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import Fastify from "fastify";
import { getAddress, toHex } from "viem";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { connectDatabase, databaseUrl } from "../packages/database/src/index.ts";
import { DomainError } from "../packages/domain/src/index.ts";
import {
  canonicalTreasuryRules,
  type TreasuryProvider,
  treasuryRules,
} from "../packages/privy/src/treasury.ts";
import { registerTreasuryRoutes } from "../services/api/src/treasury-routes.ts";
import { provisionTreasury } from "../services/treasury/src/provision.ts";

// Use a separate database so the live worker cannot consume test wallet requests.
const admin = connectDatabase().pool;
const databaseName = `treasury_test_${randomUUID().replaceAll("-", "")}`;
const testUrl = new URL(databaseUrl());
testUrl.pathname = `/${databaseName}`;
const { db, pool } = connectDatabase(testUrl.toString());
const app = Fastify();
const actors = [randomUUID(), randomUUID(), randomUUID()];
const config = {
  organizationId: toHex(1, { size: 32 }),
  escrow: "0x01742711ee569a0186349e54cffe805209808292" as const,
  maxPerAction: "5000000",
};
app.decorateRequest("actor");
app.addHook("onRequest", async (request) => {
  request.actor = { id: actors[Number(request.headers["test-actor"] ?? 0)], displayName: "Test" };
});
app.setErrorHandler((error, _request, reply) => {
  reply
    .code(error instanceof DomainError ? error.status : error instanceof z.ZodError ? 400 : 500)
    .send({ message: error instanceof Error ? error.message : "Test error" });
});
registerTreasuryRoutes(app, pool, config.escrow);
beforeAll(async () => {
  await admin.query(`create database ${databaseName}`);
  await migrate(db, { migrationsFolder: "packages/database/migrations" });
  for (const id of actors)
    await pool.query(
      "insert into users(id,privy_user_id,display_name) values($1::uuid,$1::text,'Treasury test')",
      [id],
    );
});
afterAll(async () => {
  await app.close();
  await pool.end();
  await admin.query(`drop database if exists ${databaseName}`);
  await admin.end();
});
async function organization() {
  const id = randomUUID();
  await pool.query(
    "insert into organizations(id,onchain_id,name,owner_user_id) values($1,$2,'Treasury test',$3)",
    [id, toHex(BigInt(`0x${id.replaceAll("-", "")}`), { size: 32 }), actors[0]],
  );
  for (const [i, role] of ["OWNER", "TREASURY"].entries())
    await pool.query("insert into memberships(organization_id,user_id,role) values($1,$2,$3)", [
      id,
      actors[i],
      role,
    ]);
  return id;
}
function create(orgId: string, actor = 0, cap = "5000000", key = randomUUID()) {
  return app.inject({
    method: "POST",
    url: `/api/v1/organizations/${orgId}/wallets`,
    headers: { "test-actor": String(actor), "idempotency-key": key },
    payload: { maxPerAction: cap },
  });
}
function provider(): TreasuryProvider {
  const policyId = randomUUID();
  return {
    createPolicy: vi.fn(async () => policyId),
    createWallet: vi.fn(async () => ({
      id: randomUUID(),
      address: toHex(15, { size: 20 }),
      ownerId: randomUUID(),
      policyIds: [policyId],
    })),
    verify: vi.fn(async () => {}),
    sign: vi.fn(async () => {
      throw new Error("Provisioning must not send funds.");
    }),
  };
}
describe("Organization treasury controls", () => {
  it("Accepts provider address casing and rejects a changed cap or missing condition", () => {
    const expected = treasuryRules(config);
    const returned = structuredClone(expected);
    const spender = returned[0].conditions.find((c) => c.field === "approve.spender");
    if (!spender) throw new Error("The approval rule is missing.");
    spender.value = getAddress(config.escrow);
    expect(canonicalTreasuryRules(returned)).toBe(canonicalTreasuryRules(expected));
    spender.value = toHex(9, { size: 20 });
    expect(canonicalTreasuryRules(returned)).not.toBe(canonicalTreasuryRules(expected));
    expect(canonicalTreasuryRules(treasuryRules({ ...config, maxPerAction: "6000000" }))).not.toBe(
      canonicalTreasuryRules(expected),
    );
    returned[0].conditions.pop();
    expect(canonicalTreasuryRules(returned)).not.toBe(canonicalTreasuryRules(expected));
  });
  it("Requires an owner, isolates organizations, and saves one concurrent setup", async () => {
    const id = await organization();
    expect((await create(id, 1)).statusCode).toBe(403);
    expect((await create(id, 2)).statusCode).toBe(404);
    expect((await create(id, 0, "100000001")).statusCode).toBe(400);
    const responses = await Promise.all([create(id), create(id), create(id)]);
    expect(responses.map((r) => r.statusCode)).toEqual([202, 202, 202]);
    expect(new Set(responses.map((r) => r.json().id)).size).toBe(1);
    expect(
      (await pool.query("select count(*) from outbox where aggregate_id=$1", [id])).rows[0].count,
    ).toBe("1");
    expect((await create(id, 0, "6000000")).statusCode).toBe(409);
    expect(
      (
        await app.inject({
          url: `/api/v1/organizations/${id}/wallets`,
          headers: { "test-actor": "1" },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          url: `/api/v1/organizations/${id}/wallets`,
          headers: { "test-actor": "2" },
        })
      ).statusCode,
    ).toBe(404);
  });
  it("Resumes from saved provider steps and never marks an unverified wallet ready", async () => {
    const id = await organization();
    const setup = (await create(id)).json().id;
    const service = provider();
    vi.mocked(service.createWallet).mockRejectedValueOnce(new Error("Provider timeout"));
    await expect(provisionTreasury(pool, service, setup)).rejects.toThrow("Provider timeout");
    expect(
      (
        await pool.query("select provider_policy_id,wallet_id from wallet_setups where id=$1", [
          setup,
        ])
      ).rows[0],
    ).toMatchObject({ provider_policy_id: expect.any(String), wallet_id: null });
    vi.mocked(service.verify).mockRejectedValueOnce(new Error("Policy mismatch"));
    await expect(provisionTreasury(pool, service, setup)).rejects.toThrow("Policy mismatch");
    expect(
      (await pool.query("select state from wallet_setups where id=$1", [setup])).rows[0].state,
    ).toBe("VERIFYING");
    expect(await provisionTreasury(pool, service, setup)).toMatchObject({ state: "READY" });
    expect(service.createPolicy).toHaveBeenCalledTimes(1);
    expect(service.createWallet).toHaveBeenCalledTimes(2);
    expect(service.sign).not.toHaveBeenCalled();
    expect(
      (await pool.query("select count(*) from wallets where owner_id=$1", [id])).rows[0].count,
    ).toBe("1");
  });
  it("Stops expired provider retries and rechecks the current owner role", async () => {
    const id = await organization();
    const setup = (await create(id)).json().id;
    const service = provider();
    await pool.query(
      "update wallet_setups set attempt_started_at=now()-interval '24 hours' where id=$1",
      [setup],
    );
    await expect(provisionTreasury(pool, service, setup)).rejects.toThrow("manual reconciliation");
    expect(
      (await pool.query("select state from wallet_setups where id=$1", [setup])).rows[0].state,
    ).toBe("NEEDS_RECONCILIATION");
    const other = await organization();
    const otherSetup = (await create(other)).json().id;
    await pool.query(
      "update memberships set status='REVOKED' where organization_id=$1 and user_id=$2",
      [other, actors[0]],
    );
    await expect(provisionTreasury(pool, service, otherSetup)).rejects.toMatchObject({
      status: 404,
    });
    expect(service.createPolicy).not.toHaveBeenCalled();
    expect(service.createWallet).not.toHaveBeenCalled();
  });
});
