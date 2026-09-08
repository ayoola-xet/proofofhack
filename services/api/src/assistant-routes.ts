import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { hashCanonical } from "../../../packages/crypto-envelope/src/index.ts";
import { DomainError } from "../../../packages/domain/src/index.ts";
import { PROMPT_VERSION, snapshotSchema } from "../../assistant/src/contract.ts";
import { loadCoverageSnapshot, snapshotStillCurrent } from "../../assistant/src/snapshot.ts";
import { first, idParams, member, mutate } from "./context.ts";

export function registerAssistantRoutes(app: FastifyInstance, pool: Pool, model?: string) {
  app.get("/api/v1/assistant/config", async () => ({
    available: !!model,
    model: model ?? null,
    promptVersion: PROMPT_VERSION,
  }));
  app.post("/api/v1/organizations/:id/assistant-runs", async (request, reply) => {
    const { id } = idParams(request),
      { question } = z
        .strictObject({ question: z.string().trim().min(3).max(500) })
        .parse(request.body);
    await member(pool, request.actor, id);
    if (!model)
      throw new DomainError(
        "MODEL_NOT_CONFIGURED",
        "The coverage assistant needs a configured model. Rule-based decisions remain available.",
        503,
      );
    const result = await mutate(
      pool,
      request,
      (c) => member(c, request.actor, id),
      async (c) => {
        await c.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
          `assistant-org:${id}`,
        ]);
        const limits = (
          await c.query(
            "select count(*)::int as recent,count(*) filter(where state in('QUEUED','RUNNING'))::int as active from assistant_runs where organization_id=$1 and created_at>now()-interval '1 hour'",
            [id],
          )
        ).rows[0];
        if (limits.recent >= 10 || limits.active >= 2)
          throw new DomainError(
            "ASSISTANT_LIMIT",
            "The assistant request limit is reached. Wait for an active request to finish or try again later.",
            429,
          );
        const snapshot = await loadCoverageSnapshot(c, id);
        if (!snapshot.entries.length)
          throw new DomainError(
            "NO_COVERAGE_RECORDS",
            "Register a vault and update its coverage data first.",
          );
        const inputHash = hashCanonical({
          question,
          snapshot,
          promptVersion: PROMPT_VERSION,
          model,
        });
        const row = await first(
          c,
          "insert into assistant_runs(organization_id,requested_by,question,snapshot_json,input_hash,prompt_version,requested_model) values($1,$2,$3,$4,$5,$6,$7) returning id,state,created_at",
          [
            id,
            request.actor.id,
            question,
            JSON.stringify(snapshot),
            inputHash,
            PROMPT_VERSION,
            model,
          ],
        );
        await c.query(
          "insert into outbox(deduplication_key,event_type,aggregate_id,payload_json) values($1,'ASSISTANT_RUN',$2,$3)",
          [`assistant:${row.id}`, row.id, JSON.stringify({ runId: row.id })],
        );
        return { status: 202, body: row };
      },
    );
    return reply.code(result.status).send(result.body);
  });
  app.get("/api/v1/organizations/:id/assistant-runs", async (request) => {
    const { id } = idParams(request);
    await member(pool, request.actor, id);
    return {
      items: (
        await pool.query(
          "select id,question,state,requested_model,response_model,error_code,created_at from assistant_runs where organization_id=$1 order by created_at desc limit 20",
          [id],
        )
      ).rows,
    };
  });
  app.get("/api/v1/assistant-runs/:id", async (request) => {
    const { id } = idParams(request),
      row = await first(pool, "select * from assistant_runs where id=$1", [id]);
    await member(pool, request.actor, row.organization_id);
    const snapshot = snapshotSchema.parse(row.snapshot_json);
    const current =
      row.state === "COMPLETE" && (await snapshotStillCurrent(pool, row.organization_id, snapshot));
    return {
      id: row.id,
      question: row.question,
      state: row.state === "COMPLETE" && !current ? "STALE" : row.state,
      snapshot,
      answer: row.answer_json,
      requestedModel: row.requested_model,
      responseModel: row.response_model,
      usage: row.usage_json,
      errorCode: row.error_code,
      createdAt: row.created_at,
      inputHash: row.input_hash,
      executionAllowed: false,
    };
  });
}
