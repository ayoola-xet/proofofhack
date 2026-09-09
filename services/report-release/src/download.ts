import Fastify from "fastify";
import type { Pool } from "pg";
import { keccak256 } from "viem";
import { z } from "zod";
import type { CiphertextStore } from "../../../packages/ciphertext-store/src/index.ts";
import { decryptReport } from "../../../packages/crypto-envelope/src/index.ts";
import { DomainError } from "../../../packages/domain/src/index.ts";
import type { AuthProvider } from "../../api/src/auth.ts";
import { first } from "../../api/src/context.ts";
import { reportAccess } from "./access.ts";

export function createReportDownloadApp(options: {
  pool: Pool;
  auth: AuthProvider;
  mode: "researcher" | "organization";
  store: CiphertextStore;
  resolveKey: (
    keyId: string,
    organizationId: string,
  ) => Promise<{ publicKey: string; privateKey: string }>;
}) {
  const app = Fastify({ logger: false, bodyLimit: 1000 });
  app.addHook("onRequest", async (_req, reply) => {
    reply.header("Cache-Control", "no-store").header("X-Content-Type-Options", "nosniff");
  });
  app.setErrorHandler((error: Error, _req, reply) =>
    reply
      .code(error instanceof DomainError ? error.status : error instanceof z.ZodError ? 400 : 503)
      .send({
        error: {
          code: error instanceof DomainError ? error.code : "REPORT_UNAVAILABLE",
          message:
            error instanceof DomainError ? error.message : "The report cannot be delivered now.",
        },
      }),
  );
  app.get(`/private/${options.mode}/reports/:id`, async (request, reply) => {
    const { id } = z.object({ id: z.uuid() }).parse(request.params),
      header = request.headers.authorization;
    if (!header?.startsWith("Bearer ") || header.length > 8192)
      throw new DomainError("UNAUTHENTICATED", "Sign in to read the report.", 401);
    const user = await options.auth.verify(header.slice(7));
    const actor = await first(options.pool, "select id from users where privy_user_id=$1", [
      user.subject,
    ]);
    const row = await reportAccess(options.pool, actor.id, id, options.mode);
    const org = options.mode === "organization";
    const object = org ? row.ciphertext_object_key : row.researcher_object_key,
      hash = org ? row.ciphertext_hash : row.researcher_ciphertext_hash,
      keyId = org ? row.recipient_key_id : row.researcher_key_id;
    if (!object || !hash || !keyId || (org && keyId !== row.policy_json.reportRecipientKeyId))
      throw new DomainError(
        "REPORT_INTEGRITY",
        "The encrypted report metadata is incomplete.",
        503,
      );
    const envelope = z
      .strictObject({
        ciphertext: z.string().min(1),
        nonce: z.string().min(1),
        wrappedKey: z.string().min(1),
      })
      .parse(
        JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(await options.store.read(object, hash)),
        ),
      );
    const keys = await options.resolveKey(keyId, row.organization_id),
      plaintext = await decryptReport(envelope, keys);
    try {
      if (keccak256(plaintext) !== row.report_hash)
        throw new DomainError(
          "REPORT_INTEGRITY",
          "The decrypted report does not match its signed commitment.",
          503,
        );
      const report = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext));
      if (
        report.claimId !== row.claim_id ||
        report.bountyId !== row.bounty_id ||
        report.policyHash !== row.bounty_id ||
        report.evidenceScope !== "FIXTURE_ONLY" ||
        report.verifierMode !== "TRUSTED_SERVICE"
      )
        throw new DomainError("REPORT_INTEGRITY", "The report does not match this claim.", 503);
      // Recheck current membership and payment after the bounded decryption operation.
      await reportAccess(options.pool, actor.id, id, options.mode);
      return reply
        .type("application/json")
        .header("Content-Disposition", `attachment; filename="proofofhack-report-${id}.json"`)
        .send(Buffer.from(plaintext));
    } finally {
      plaintext.fill(0);
    }
  });
  return app;
}
