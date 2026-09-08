import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { keccak256 } from "viem";
import { z } from "zod";
import type { CiphertextStore } from "../../../packages/ciphertext-store/src/index.ts";
import { bytes32, DomainError, MAX_EVIDENCE_BYTES } from "../../../packages/domain/src/index.ts";
import type { WalletIdentityProvider } from "../../../packages/privy/src/wallets.ts";
import type { PublicServiceConfig } from "../../../packages/service-config/src/index.ts";
import { first, mutate } from "./context.ts";

export type ClaimServices = { evidence: CiphertextStore; config: PublicServiceConfig };
export function registerClaimRoutes(
  app: FastifyInstance,
  pool: Pool,
  services?: ClaimServices,
  identities?: WalletIdentityProvider,
) {
  app.addContentTypeParser("application/octet-stream", { parseAs: "buffer" }, (_req, body, done) =>
    done(null, body),
  );
  app.post("/api/v1/bounties/:id/uploads", async (request, reply) => {
    if (!services || !identities)
      throw new DomainError("SERVICE_NOT_CONFIGURED", "Claim services are not configured.", 503);
    const { id } = z.object({ id: bytes32 }).parse(request.params);
    const input = z
      .strictObject({
        keyId: bytes32,
        algorithm: z.literal("X25519_SEALED_BOX"),
        ciphertextHash: bytes32,
        byteLength: z
          .number()
          .int()
          .min(49)
          .max(MAX_EVIDENCE_BYTES + 48),
        claimantWalletId: z.uuid(),
      })
      .parse(request.body);
    if (input.keyId !== services.config.evidenceKeyId)
      throw new DomainError("EVIDENCE_KEY_MISMATCH", "Refresh the verifier encryption key.");
    const wallet = await first(
      pool,
      "select w.*,u.privy_user_id from wallets w join users u on u.id=w.owner_id where w.id=$1 and w.owner_type='USER' and w.owner_id=$2 and w.provider='PRIVY'",
      [input.claimantWalletId, request.actor.id],
    );
    const live = await identities.userWallets(wallet.privy_user_id);
    if (
      !live.some(
        (w) =>
          w.providerWalletId === wallet.provider_wallet_id &&
          w.address.toLowerCase() === wallet.address,
      )
    )
      throw new DomainError("WALLET_UNLINKED", "Verify a currently linked reward wallet.", 403);
    const result = await mutate(
      pool,
      request,
      async (c) => {
        await first(c, "select id from wallets where id=$1 and owner_id=$2", [
          wallet.id,
          request.actor.id,
        ]);
      },
      async (c) => {
        const bounty = await first(c, "select * from bounties where bounty_id=$1", [id]);
        if (
          bounty.chain_state !== "FUNDED" ||
          bounty.chain_id !== wallet.chain_id ||
          BigInt(bounty.policy_json.submissionDeadline) <= BigInt(Math.floor(Date.now() / 1000))
        )
          throw new DomainError(
            "BOUNTY_UNAVAILABLE",
            "This bounty does not accept another claim now.",
          );
        if (
          bounty.policy_json.adapterCodeHash !== services.config.adapterCodeHash ||
          bounty.policy_json.verifierConfigHash !== services.config.verifierConfigHash
        )
          throw new DomainError(
            "VERIFIER_VERSION_UNAVAILABLE",
            "This bounty needs its original verifier version.",
          );
        await c.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
          `uploads:${request.actor.id}`,
        ]);
        const pending = await c.query(
          "select id from uploads where owner_user_id=$1 and state='UPLOADING' and expires_at>now() limit 5",
          [request.actor.id],
        );
        if (pending.rows.length >= 5)
          throw new DomainError(
            "UPLOAD_LIMIT",
            "Complete an existing upload before starting another.",
            429,
          );
        const uploadId = randomUUID(),
          claimId = `0x${randomBytes(32).toString("hex")}`;
        await c.query(
          "insert into uploads(id,owner_user_id,bounty_id,object_key,ciphertext_hash,key_id,byte_length,state,expires_at) values($1::uuid,$2,$3,$1::text,$4,$5,$6,'UPLOADING',now()+interval '24 hours')",
          [uploadId, request.actor.id, id, input.ciphertextHash, input.keyId, input.byteLength],
        );
        await c.query(
          "insert into claims(claim_id,bounty_id,researcher_user_id,claimant_wallet_id,claimant_address,upload_id,evidence_commitment,job_state) values($1,$2,$3,$4,$5,$6,$7,'UPLOADING')",
          [
            claimId,
            id,
            request.actor.id,
            wallet.id,
            wallet.address,
            uploadId,
            input.ciphertextHash,
          ],
        );
        return {
          status: 201,
          body: {
            uploadId,
            claimId,
            state: "UPLOADING",
            uploadPath: `/api/v1/uploads/${uploadId}/ciphertext`,
            expiresInSeconds: 900,
          },
        };
      },
    );
    return reply.code(result.status).send(result.body);
  });
  app.put("/api/v1/uploads/:id/ciphertext", async (request) => {
    if (!services)
      throw new DomainError("SERVICE_NOT_CONFIGURED", "Claim services are not configured.", 503);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    if (!Buffer.isBuffer(request.body))
      throw new DomainError(
        "CIPHERTEXT_REQUIRED",
        "Send the encrypted file as application/octet-stream.",
        400,
      );
    const data = new Uint8Array(request.body),
      hash = keccak256(data),
      c = await pool.connect();
    try {
      await c.query("begin");
      const row = await first(
        c,
        "select u.*,c.claim_id,c.job_state from uploads u join claims c on c.upload_id=u.id where u.id=$1 and u.owner_user_id=$2 for update of u,c",
        [id, request.actor.id],
      );
      if (hash !== row.ciphertext_hash || data.length !== row.byte_length)
        throw new DomainError(
          "CIPHERTEXT_MISMATCH",
          "The encrypted file does not match the prepared upload.",
          422,
        );
      if (row.state === "UPLOADED") {
        await c.query("commit");
        return { uploadId: id, claimId: row.claim_id, state: row.job_state };
      }
      if (row.state !== "UPLOADING" || Date.now() - row.created_at.getTime() > 900000)
        throw new DomainError("UPLOAD_EXPIRED", "Prepare a new encrypted upload.", 410);
      await services.evidence.put(row.object_key, data, hash);
      await c.query("update uploads set state='UPLOADED',updated_at=now() where id=$1", [id]);
      await c.query(
        "update claims set job_state='ADMISSION_PENDING',updated_at=now() where claim_id=$1",
        [row.claim_id],
      );
      await c.query(
        "insert into outbox(deduplication_key,event_type,aggregate_id,payload_json) values($1,'CLAIM_PROCESS',$2,$3) on conflict(deduplication_key) do nothing",
        [`claim:${row.claim_id}`, row.claim_id, JSON.stringify({ claimId: row.claim_id })],
      );
      await c.query("commit");
      return { uploadId: id, claimId: row.claim_id, state: "ADMISSION_PENDING" };
    } catch (error) {
      await c.query("rollback");
      throw error;
    } finally {
      c.release();
    }
  });
  app.get("/api/v1/claims/me", async (request) => ({
    items: (
      await pool.query(
        "select c.claim_id,c.bounty_id,c.job_state,c.claimant_address,c.reservation_expiry,r.id as report_id,r.state as report_state,r.report_hash,a.outcome,b.chain_state from claims c join bounties b on b.bounty_id=c.bounty_id left join reports r on r.claim_id=c.claim_id left join assessments a on a.claim_id=c.claim_id where c.researcher_user_id=$1 order by c.created_at desc limit 100",
        [request.actor.id],
      )
    ).rows,
  }));
}
