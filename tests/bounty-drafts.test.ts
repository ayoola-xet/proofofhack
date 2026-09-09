import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Hex, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectDatabase } from "../packages/database/src/index.ts";
import { InternalClient } from "../packages/service-auth/src/http.ts";
import type { PublicServiceConfig } from "../packages/service-config/src/index.ts";
import { createApp } from "../services/api/src/app.ts";
import { LocalAuthProvider } from "../services/api/src/auth.ts";
import { createReleaseApp } from "../services/report-release/src/app.ts";

const { pool } = connectDatabase();
const directory = await mkdtemp(join(tmpdir(), "proofofhack-keys-"));
const account = privateKeyToAccount(`0x${randomBytes(32).toString("hex")}` as Hex);
const ids = ["Owner", "Reviewer", "Other"].map((displayName) => ({
  subject: `local:test:${randomUUID()}`,
  token: randomBytes(32).toString("hex"),
  displayName,
}));
const identity = generateKeyPairSync("ed25519");
const privateKey = identity.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicKey = identity.publicKey.export({ type: "spki", format: "pem" }).toString();
const release = createReleaseApp(pool, { api: publicKey }, directory);
const releaseOrigin = await release.listen({ host: "127.0.0.1", port: 0 });
const hash = toHex(1, { size: 32 });
const config: PublicServiceConfig = {
  schemaVersion: "1",
  testnetOnly: true,
  evidenceScope: "FIXTURE_ONLY",
  verifierMode: "TRUSTED_SERVICE",
  evidenceKeyId: hash,
  evidencePublicKey: "test-public-key",
  admissionSigner: account.address,
  verdictSigner: account.address,
  adapterCodeHash: hash,
  verifierConfigHash: hash,
  serviceIdentities: {
    api: publicKey,
    worker: publicKey,
    verifier: publicKey,
    "report-release": publicKey,
  },
};
const app = await createApp({
  pool,
  auth: new LocalAuthProvider(ids, "local"),
  appEnv: "local",
  webOrigin: "http://127.0.0.1:5173",
  walletIdentity: {
    userWallets: async () => [
      { providerWalletId: `test:${account.address}`, address: account.address.toLowerCase() },
    ],
  },
  bountyServices: {
    publicConfig: config,
    escrow: toHex(2, { size: 20 }),
    release: new InternalClient(releaseOrigin, "api", "report-release", privateKey),
  },
});
const headers = (actor = 0, key = randomUUID()) => ({
  authorization: `Bearer ${ids[actor].token}`,
  "idempotency-key": key,
});
const userIds: string[] = [];
let orgId = "",
  programId = "",
  walletId = "",
  refundId = "",
  vaultId = "",
  manifestId = "",
  draftId = "";
let manifest: Record<string, unknown>;
let policyHash = "";
beforeAll(async () => {
  for (let i = 0; i < 3; i++)
    userIds.push((await app.inject({ url: "/api/v1/me", headers: headers(i) })).json().user.id);
  orgId = (
    await app.inject({
      method: "POST",
      url: "/api/v1/organizations",
      headers: headers(),
      payload: { name: "Bounty flow test" },
    })
  ).json().id;
  await app.inject({
    method: "POST",
    url: `/api/v1/organizations/${orgId}/members`,
    headers: headers(),
    payload: { userId: userIds[1], role: "REVIEWER" },
  });
  programId = (
    await app.inject({
      method: "POST",
      url: `/api/v1/organizations/${orgId}/programs`,
      headers: headers(),
      payload: { name: "Fixture program" },
    })
  ).json().id;
  walletId = (
    await app.inject({
      method: "POST",
      url: "/api/v1/wallets/sync",
      headers: headers(),
      payload: {},
    })
  ).json().items[0].id;
  refundId = randomUUID();
  await pool.query(
    "insert into wallets(id,provider,provider_wallet_id,owner_type,owner_id,chain_id,address) values($1,'PRIVY',$2,'ORGANIZATION',$3,'5042002',$4)",
    [refundId, randomUUID(), orgId, account.address.toLowerCase()],
  );
  const source = (await app.inject({ url: "/api/v1/coverage/sources", headers: headers() })).json()
    .items[0];
  vaultId = (
    await app.inject({
      method: "POST",
      url: `/api/v1/organizations/${orgId}/vaults`,
      headers: headers(),
      payload: { sourceId: source.id },
    })
  ).json().id;
  await pool.query(
    "insert into vault_observations(vault_id,provider_deployment_id,schema_version,observed_block,observed_hash,indexed_head,observed_at,metrics_json,read_status) values($1,'test','1',100,$2,101,now(),$3,'OK')",
    [
      vaultId,
      hash,
      JSON.stringify({ hasIndexingErrors: false, indexedHeadAt: new Date().toISOString() }),
    ],
  );
});
afterAll(async () => {
  await app.close();
  await release.close();
  await pool.query("delete from idempotency_records where actor_id=any($1::text[])", [userIds]);
  await pool.query("delete from audit_events where actor_id=any($1::text[])", [userIds]);
  await pool.query("delete from bounties where program_id=$1", [programId]);
  await pool.query("delete from bounty_drafts where program_id=$1", [programId]);
  await pool.query("delete from fixture_manifests where organization_id=$1", [orgId]);
  await pool.query("delete from outbox where aggregate_id=$1", [orgId]);
  await pool.query("delete from vault_observations where vault_id=$1", [vaultId]);
  await pool.query("delete from registered_vaults where organization_id=$1", [orgId]);
  await pool.query("delete from programs where organization_id=$1", [orgId]);
  await pool.query("delete from organization_keys where organization_id=$1", [orgId]);
  await pool.query("delete from wallets where owner_id=$1 or owner_id=any($2::uuid[])", [
    orgId,
    userIds,
  ]);
  await pool.query("delete from memberships where organization_id=$1", [orgId]);
  await pool.query("delete from organizations where id=$1", [orgId]);
  await pool.query("delete from users where id=any($1::uuid[])", [userIds]);
  await pool.end();
  await rm(directory, { recursive: true, force: true });
});
describe("Signed fixtures and exact bounty approval", () => {
  it("Creates one organization key through an authenticated separate service", async () => {
    expect(
      (
        await release.inject({
          method: "POST",
          url: "/internal/organization-keys",
          payload: { organizationId: orgId, actorId: userIds[0] },
        })
      ).statusCode,
    ).toBe(401);
    const requests = await Promise.all(
      Array.from({ length: 3 }, () =>
        app.inject({
          method: "POST",
          url: `/api/v1/organizations/${orgId}/report-key`,
          headers: headers(),
          payload: {},
        }),
      ),
    );
    expect(requests.map((r) => r.statusCode)).toEqual([200, 200, 200]);
    expect(new Set(requests.map((r) => r.json().keyId)).size).toBe(1);
    expect(requests[0].body).not.toMatch(/privateKey|PRIVATE KEY/);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/v1/organizations/${orgId}/report-key`,
          headers: headers(1),
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
  });
  it("Prepares three synthetic fixtures and verifies the exact owner signature", async () => {
    const request = {
      method: "POST" as const,
      url: `/api/v1/organizations/${orgId}/fixture-manifests/prepare`,
      headers: headers(),
      payload: { vaultId, signingWalletId: walletId },
    };
    const prepared = await app.inject(request);
    expect(prepared.statusCode).toBe(201);
    expect(prepared.json().fixtures).toHaveLength(3);
    expect(prepared.json().manifest.synthetic).toBe(true);
    manifestId = prepared.json().id;
    manifest = prepared.json().manifest;
    expect((await app.inject(request)).json().id).toBe(manifestId);
    const wrong = await account.signMessage({ message: "Different manifest" });
    const rejected = await app.inject({
      method: "POST",
      url: `/api/v1/fixture-manifests/${manifestId}/sign`,
      headers: { ...headers(), "if-match": "1" },
      payload: { signature: wrong },
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().error.code).toBe("MANIFEST_SIGNATURE_MISMATCH");
    const signature = await account.signMessage({ message: prepared.json().message });
    const signed = await app.inject({
      method: "POST",
      url: `/api/v1/fixture-manifests/${manifestId}/sign`,
      headers: { ...headers(), "if-match": "1" },
      payload: { signature },
    });
    expect(signed.statusCode).toBe(200);
    expect(signed.json().status).toBe("SIGNED");
    await expect(
      pool.query("update fixture_manifests set root=$2 where id=$1", [
        manifestId,
        toHex(7, { size: 32 }),
      ]),
    ).rejects.toMatchObject({ code: "23514" });
  });
  it("Requires an organization refund wallet and binds all fixture and key commitments", async () => {
    const input = {
      manifestId,
      refundWalletId: walletId,
      reward: "1000000",
      minimumDiscrepancy: "1000000",
      submissionDeadline: String(Math.floor(Date.now() / 1000) + 3600),
      reservationDurationSeconds: 300,
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/v1/programs/${programId}/bounty-drafts`,
          headers: headers(),
          payload: input,
        })
      ).statusCode,
    ).toBe(404);
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/programs/${programId}/bounty-drafts`,
      headers: headers(1),
      payload: { ...input, refundWalletId: refundId },
    });
    expect(response.statusCode).toBe(201);
    draftId = response.json().id;
    policyHash = response.json().policy_hash;
    expect(response.json().policy.fixtureManifestRoot).toBe(manifest.root);
    expect(response.json().policy.refundRecipient).toBe(account.address.toLowerCase());
    expect(response.json().policy.reportRecipientKeyId).not.toBe(hash);
    expect(
      BigInt(response.json().policy.settlementDeadline) - BigInt(input.submissionDeadline),
    ).toBe(3900n);
  });
  it("Binds a short refund cutoff and rejects an invalid grace period", async () => {
    const payload = {
      manifestId,
      refundWalletId: refundId,
      reward: "1000000",
      minimumDiscrepancy: "1000000",
      submissionDeadline: String(Math.floor(Date.now() / 1000) + 600),
      reservationDurationSeconds: 60,
      settlementGraceSeconds: 0,
    };
    for (const settlementGraceSeconds of [-1, 86401, 0.5]) {
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/api/v1/programs/${programId}/bounty-drafts`,
            headers: headers(),
            payload: { ...payload, settlementGraceSeconds },
          })
        ).statusCode,
      ).toBe(400);
    }
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/programs/${programId}/bounty-drafts`,
      headers: headers(),
      payload,
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().policy.settlementDeadline).toBe(
      String(BigInt(payload.submissionDeadline) + 60n),
    );
    expect(response.json().policy.reservationDurationSeconds).toBe("60");
  });
  it("Allows only owner approval and rejects later database policy changes", async () => {
    const req = {
      method: "POST" as const,
      url: `/api/v1/bounty-drafts/${draftId}/approve`,
      headers: { ...headers(1), "if-match": "1" },
      payload: { policyHash },
    };
    expect((await app.inject(req)).statusCode).toBe(403);
    const owner = { ...req, headers: { ...headers(), "if-match": "1" } };
    expect((await app.inject({ ...owner, payload: { policyHash: hash } })).statusCode).toBe(409);
    expect(
      (await app.inject({ ...owner, headers: { ...headers(), "if-match": "1" } })).statusCode,
    ).toBe(200);
    await expect(
      pool.query("update bounty_drafts set policy_hash=$2 where id=$1", [draftId, hash]),
    ).rejects.toMatchObject({ code: "23514" });
    expect(
      (
        await app.inject({
          url: `/api/v1/organizations/${orgId}/bounty-drafts`,
          headers: headers(2),
        })
      ).statusCode,
    ).toBe(404);
  });
  it("Shows final bounty state without a direct wallet funding request", async () => {
    const read = () =>
      app.inject({ url: `/api/v1/organizations/${orgId}/bounty-drafts`, headers: headers() });
    const draft = (await read()).json().items.find((item: { id: string }) => item.id === draftId);
    expect(draft).toMatchObject({ status: "APPROVED", chain_state: null, creation_tx: null });
    const transactionHash = toHex(18, { size: 32 });
    // The final funding projection is shared by direct funding and controller allocation.
    await pool.query(
      `insert into bounties(bounty_id,program_id,policy_hash,policy_json,chain_id,escrow,
      reward,unallocated_reward,chain_state,creation_tx) values($1,$2,$1,$3,'5042002',$4,'1000000','1000000','FUNDED',$5)`,
      [policyHash, programId, draft.policy, draft.policy.escrow, transactionHash],
    );
    expect(
      (await read()).json().items.find((item: { id: string }) => item.id === draftId),
    ).toMatchObject({ chain_state: "FUNDED", creation_tx: transactionHash });
    await pool.query(
      "update bounties set chain_state='PAID',unallocated_reward='0' where bounty_id=$1",
      [policyHash],
    );
    expect(
      (await read()).json().items.find((item: { id: string }) => item.id === draftId),
    ).toMatchObject({ chain_state: "PAID", creation_tx: transactionHash });
    expect(
      (
        await app.inject({
          url: `/api/v1/organizations/${orgId}/bounty-drafts`,
          headers: headers(2),
        })
      ).statusCode,
    ).toBe(404);
  });
});
