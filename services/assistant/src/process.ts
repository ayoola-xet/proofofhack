import type { Pool } from "pg";
import { z } from "zod";
import { hashCanonical } from "../../../packages/crypto-envelope/src/index.ts";
import { first } from "../../api/src/context.ts";
import { PROMPT_VERSION, snapshotSchema, validateAnswer } from "./contract.ts";
import type { ExplanationProvider } from "./provider.ts";
import { snapshotStillCurrent } from "./snapshot.ts";

export async function processAssistantRun(
  pool: Pool,
  provider: ExplanationProvider,
  runId: string,
) {
  z.uuid().parse(runId);
  const c = await pool.connect(),
    lock = `assistant-run:${runId}`;
  let locked = false;
  try {
    locked = (
      await c.query("select pg_try_advisory_lock(hashtextextended($1,0)) as locked", [lock])
    ).rows[0].locked;
    if (!locked) throw new Error("Assistant run is already in progress.");
    const row = await first(c, "select * from assistant_runs where id=$1", [runId]);
    if (!["QUEUED", "RUNNING"].includes(row.state)) return { state: row.state };
    const member = (
      await c.query(
        "select user_id from memberships where organization_id=$1 and user_id=$2 and status='ACTIVE'",
        [row.organization_id, row.requested_by],
      )
    ).rows[0];
    if (!member) {
      await c.query(
        "update assistant_runs set state='CANCELLED',error_code='MEMBERSHIP_REMOVED',updated_at=now() where id=$1",
        [runId],
      );
      return { state: "CANCELLED" };
    }
    const snapshot = snapshotSchema.parse(row.snapshot_json);
    if (
      row.prompt_version !== PROMPT_VERSION ||
      row.requested_model !== provider.model ||
      hashCanonical({
        question: row.question,
        snapshot,
        promptVersion: row.prompt_version,
        model: row.requested_model,
      }) !== row.input_hash
    )
      throw new Error("The saved model request bindings differ.");
    if (!(await snapshotStillCurrent(c, row.organization_id, snapshot))) {
      await c.query(
        "update assistant_runs set state='STALE',error_code='SOURCE_CHANGED',updated_at=now() where id=$1",
        [runId],
      );
      return { state: "STALE" };
    }
    if (row.attempts >= 2) {
      await c.query(
        "update assistant_runs set state='FAILED',error_code='RETRY_LIMIT',updated_at=now() where id=$1",
        [runId],
      );
      return { state: "FAILED" };
    }
    await c.query(
      "update assistant_runs set state='RUNNING',attempts=attempts+1,updated_at=now() where id=$1",
      [runId],
    );
    let generated: Awaited<ReturnType<ExplanationProvider["generate"]>>;
    try {
      generated = await provider.generate(row.question, snapshot, runId);
    } catch {
      await c.query(
        "update assistant_runs set state='FAILED',error_code='MODEL_UNAVAILABLE',updated_at=now() where id=$1",
        [runId],
      );
      return { state: "FAILED" };
    }
    let answer: ReturnType<typeof validateAnswer>;
    try {
      answer = validateAnswer(generated.answer, snapshot);
    } catch {
      await c.query(
        "update assistant_runs set state='FAILED',error_code='MODEL_OUTPUT_REJECTED',response_id=$2,response_model=$3,usage_json=$4,updated_at=now() where id=$1",
        [runId, generated.responseId, generated.model, JSON.stringify(generated.usage)],
      );
      return { state: "FAILED" };
    }
    const current = await snapshotStillCurrent(c, row.organization_id, snapshot);
    const state = current ? "COMPLETE" : "STALE";
    await c.query(
      "update assistant_runs set state=$2,answer_json=$3,response_id=$4,response_model=$5,usage_json=$6,error_code=$7,updated_at=now() where id=$1",
      [
        runId,
        state,
        JSON.stringify(answer),
        generated.responseId,
        generated.model,
        JSON.stringify(generated.usage),
        current ? null : "SOURCE_CHANGED",
      ],
    );
    return { state };
  } finally {
    if (locked) await c.query("select pg_advisory_unlock(hashtextextended($1,0))", [lock]);
    c.release();
  }
}
