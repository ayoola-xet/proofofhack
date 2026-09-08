import { createHash, randomBytes, randomUUID } from "node:crypto";
import { encodeFunctionData, erc20Abi, type Hex, keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { connectDatabase } from "../packages/database/src/index.ts";
import { createApp } from "../services/api/src/app.ts";
import { LocalAuthProvider } from "../services/api/src/auth.ts";

const database = connectDatabase();
const identities = ["Owner", "Reviewer", "Other organization"].map((displayName) => ({
  displayName,
  subject: `local:test:${randomUUID()}`,
  token: randomBytes(32).toString("hex"),
}));
const app = await createApp({
  pool: database.pool,
  walletIdentity: {
    userWallets: async (subject) => [
      {
        providerWalletId: subject,
        address: `0x${createHash("sha256").update(subject).digest("hex").slice(0, 40)}`,
      },
    ],
  },
  auth: new LocalAuthProvider(identities, "local"),
  appEnv: "local",
  webOrigin: "http://localhost:5173",
});
const userIds: string[] = [];
let orgId = "";
function headers(actor = 0, key = randomUUID()) {
  return { authorization: `Bearer ${identities[actor].token}`, "idempotency-key": key };
}

beforeAll(async () => {
  for (let actor = 0; actor < 3; actor++)
    userIds.push(
      (await app.inject({ method: "GET", url: "/api/v1/me", headers: headers(actor) })).json().user
        .id,
    );
});
afterAll(async () => {
  await app.close();
  const c = await database.pool.connect();
  try {
    await c.query("begin");
    await c.query("delete from idempotency_records where actor_id=any($1::text[])", [userIds]);
    await c.query("delete from audit_events where actor_id=any($1::text[])", [userIds]);
    await c.query(
      "delete from programs where organization_id in (select id from organizations where owner_user_id=any($1::uuid[]))",
      [userIds],
    );
    await c.query(
      "delete from memberships where organization_id in (select id from organizations where owner_user_id=any($1::uuid[]))",
      [userIds],
    );
    await c.query(
      "delete from outbox where aggregate_id in(select id::text from organizations where owner_user_id=any($1::uuid[]))",
      [userIds],
    );
    await c.query(
      "delete from registered_vaults where organization_id in(select id from organizations where owner_user_id=any($1::uuid[]))",
      [userIds],
    );
    await c.query("delete from organizations where owner_user_id=any($1::uuid[])", [userIds]);
    await c.query(
      "delete from transaction_intents where wallet_id in(select id from wallets where owner_type='USER' and owner_id=any($1::uuid[]))",
      [userIds],
    );
    await c.query("delete from wallets where owner_type='USER' and owner_id=any($1::uuid[])", [
      userIds,
    ]);
    await c.query("delete from users where id=any($1::uuid[])", [userIds]);
    await c.query("commit");
  } catch (error) {
    await c.query("rollback");
    throw error;
  } finally {
    c.release();
    await database.pool.end();
  }
});

describe("Database-backed access and retry rules", () => {
  it("Allows health checks but requires valid authentication for records", async () => {
    expect((await app.inject("/api/v1/health")).statusCode).toBe(200);
    expect((await app.inject("/api/v1/me")).statusCode).toBe(401);
    expect(
      (await app.inject({ url: "/api/v1/me", headers: { authorization: "Bearer invalid" } }))
        .statusCode,
    ).toBe(401);
    expect(() => new LocalAuthProvider(identities, "arc-testnet")).toThrow();
  });
  it("Creates one organization for simultaneous identical retries", async () => {
    const key = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        app.inject({
          method: "POST",
          url: "/api/v1/organizations",
          headers: headers(0, key),
          payload: { name: "Test organization" },
        }),
      ),
    );
    expect(results.map((r) => r.statusCode)).toEqual(Array(6).fill(201));
    const ids = results.map((r) => r.json().id);
    expect(new Set(ids).size).toBe(1);
    orgId = ids[0];
    const conflict = await app.inject({
      method: "POST",
      url: "/api/v1/organizations",
      headers: headers(0, key),
      payload: { name: "Changed name" },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("IDEMPOTENCY_CONFLICT");
  });
  it("Hides another organization's records and never returns a stack", async () => {
    const response = await app.inject({
      url: `/api/v1/organizations/${orgId}`,
      headers: headers(2),
    });
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toMatch(/stack|postgres|memberships/i);
    expect(response.headers["cache-control"]).toBe("no-store");
  });
  it("Rejects unknown fields and missing mutation keys", async () => {
    const payload = { name: "Another program", approved: true };
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/v1/organizations/${orgId}/programs`,
          headers: headers(),
          payload,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/organizations",
          headers: { authorization: headers().authorization },
          payload: { name: "No key" },
        })
      ).statusCode,
    ).toBe(400);
  });
  it("Keeps at least one active owner", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/organizations/${orgId}/members/${userIds[0]}`,
      headers: { ...headers(), "if-match": "1" },
      payload: { role: "VIEWER" },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("LAST_OWNER");
  });
  it("Applies role permissions and rejects stale updates", async () => {
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/v1/organizations/${orgId}/members`,
          headers: headers(),
          payload: { userId: userIds[1], role: "REVIEWER" },
        })
      ).statusCode,
    ).toBe(201);
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/organizations/${orgId}/programs`,
      headers: headers(1),
      payload: { name: "Accounting fixture program" },
    });
    expect(response.statusCode).toBe(201);
    expect(
      (await app.inject({ url: `/api/v1/organizations/${orgId}/receipts`, headers: headers(1) }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/v1/organizations/${orgId}/members/${userIds[1]}`,
          headers: { ...headers(), "if-match": "7" },
          payload: { role: "VIEWER" },
        })
      ).json().error.code,
    ).toBe("STALE_RESOURCE");
  });
  it("Rechecks authorization before returning a saved retry response", async () => {
    const key = randomUUID();
    const request = {
      method: "POST" as const,
      url: `/api/v1/organizations/${orgId}/programs`,
      headers: headers(1, key),
      payload: { name: "Before removal" },
    };
    expect((await app.inject(request)).statusCode).toBe(201);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/v1/organizations/${orgId}/members/${userIds[1]}`,
          headers: { ...headers(), "if-match": "1" },
          payload: { status: "DISABLED" },
        })
      ).statusCode,
    ).toBe(200);
    expect((await app.inject(request)).statusCode).toBe(404);
    expect(
      (await app.inject({ url: `/api/v1/organizations/${orgId}`, headers: headers(1) })).statusCode,
    ).toBe(404);
  });
  it("Registers only configured sources and queues one refresh on retry", async () => {
    const source = (
      await app.inject({ url: "/api/v1/coverage/sources", headers: headers() })
    ).json().items[0];
    const request = {
      method: "POST" as const,
      url: `/api/v1/organizations/${orgId}/vaults`,
      headers: headers(),
      payload: { sourceId: source.id },
    };
    const first = await app.inject(request);
    expect(first.statusCode).toBe(201);
    expect((await app.inject(request)).json().id).toBe(first.json().id);
    expect(
      (
        await database.pool.query("select count(*)::int n from outbox where deduplication_key=$1", [
          `vault:${first.json().id}`,
        ])
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await app.inject({
          ...request,
          headers: headers(),
          payload: { sourceId: "1:unconfigured" },
        })
      ).statusCode,
    ).toBe(400);
    expect((await app.inject({ ...request, headers: headers(2) })).statusCode).toBe(404);
    const coverage = await app.inject({
      url: `/api/v1/organizations/${orgId}/coverage`,
      headers: headers(),
    });
    expect(coverage.statusCode).toBe(200);
    expect(coverage.json().items[0].reason).toBe("MISSING_OBSERVATION");
  });
  it("Stores provider-verified wallets and hides them from other users", async () => {
    const request = {
      method: "POST" as const,
      url: "/api/v1/wallets/sync",
      headers: headers(),
      payload: {},
    };
    const response = await app.inject(request);
    expect(response.statusCode).toBe(200);
    const wallet = response.json().items[0];
    expect((await app.inject(request)).json().items[0].id).toBe(wallet.id);
    expect(
      (await app.inject({ url: `/api/v1/wallets/${wallet.id}/transfers`, headers: headers(2) }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          ...request,
          headers: headers(),
          payload: { address: "0x0000000000000000000000000000000000000001" },
        })
      ).statusCode,
    ).toBe(400);
  });
  it("Rejects unsupported and unsigned relay requests without provider calls", async () => {
    for (const method of [
      "personal_sign",
      "eth_sendTransaction",
      "eth_sendRawTransaction",
      "debug_traceCall",
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/rpc/arc",
        payload: { jsonrpc: "2.0", id: 1, method, params: [] },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().error.code).toBe(-32000);
    }
  });
  it("Saves a signed transfer hash before an uncertain provider response", async () => {
    const account = privateKeyToAccount(`0x${randomBytes(32).toString("hex")}` as Hex);
    const asset = "0x3600000000000000000000000000000000000000";
    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [account.address, 10000n],
    });
    const walletId = randomUUID(),
      intentId = randomUUID();
    await database.pool.query(
      "insert into wallets(id,provider,provider_wallet_id,owner_type,owner_id,chain_id,address) values($1,'PRIVY',$2,'USER',$3,'5042002',$4)",
      [walletId, `test:${walletId}`, userIds[0], account.address.toLowerCase()],
    );
    const request = {
      from: account.address.toLowerCase(),
      to: asset,
      data,
      nonce: 0,
      amount: "10000",
      recipient: account.address.toLowerCase(),
      chainId: 5042002,
      value: "0",
    };
    await database.pool.query(
      "insert into transaction_intents(id,chain_id,provider,wallet_id,purpose,request_hash,idempotency_key,sender_nonce,state,request_json) values($1,'5042002','PRIVY',$2,'USER_TRANSFER','test',$3,0,'AWAITING_SIGNATURE',$4)",
      [intentId, walletId, randomUUID(), JSON.stringify(request)],
    );
    const raw = await account.signTransaction({
      chainId: 5042002,
      to: asset,
      data,
      nonce: 0,
      value: 0n,
      gas: 100000n,
      maxFeePerGas: 1000000000n,
      maxPriorityFeePerGas: 100000000n,
    });
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Connection lost"));
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/rpc/arc",
        payload: { jsonrpc: "2.0", id: 1, method: "eth_sendRawTransaction", params: [raw] },
      });
      expect(response.json().error.code).toBe(-32000);
      const stored = (
        await database.pool.query(
          "select state,transaction_hash from transaction_intents where id=$1",
          [intentId],
        )
      ).rows[0];
      expect(stored).toEqual({ state: "SUBMITTED", transaction_hash: keccak256(raw) });
      fetch.mockResolvedValue(
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: keccak256(raw) }), {
          status: 200,
        }),
      );
      const retry = await app.inject({
        method: "POST",
        url: "/api/v1/rpc/arc",
        payload: { jsonrpc: "2.0", id: 1, method: "eth_sendRawTransaction", params: [raw] },
      });
      expect(retry.json().result).toBe(keccak256(raw));
      expect(
        (await database.pool.query("select state from transaction_intents where id=$1", [intentId]))
          .rows[0].state,
      ).toBe("BROADCAST");
    } finally {
      fetch.mockRestore();
    }
  });
  it("Uses bounded pagination", async () => {
    const page = await app.inject({
      url: `/api/v1/organizations/${orgId}/programs?limit=1`,
      headers: headers(),
    });
    expect(page.json().items.length).toBe(1);
    expect(page.json().nextCursor).toBeTruthy();
    expect(
      (
        await app.inject({
          url: `/api/v1/organizations/${orgId}/programs?limit=101`,
          headers: headers(),
        })
      ).statusCode,
    ).toBe(400);
  });
});
