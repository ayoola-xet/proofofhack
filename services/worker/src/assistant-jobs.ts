import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import { z } from "zod";
import { processAssistantRun } from "../../assistant/src/process.ts";
import type { ExplanationProvider } from "../../assistant/src/provider.ts";
export async function startAssistantJobs(boss: PgBoss, pool: Pool, provider: ExplanationProvider) {
  await boss.createQueue("assistant-run", {
    retryLimit: 1,
    retryDelay: 5,
    expireInSeconds: 150,
    policy: "singleton",
  });
  await boss.work<{ runId: string }>(
    "assistant-run",
    { pollingIntervalSeconds: 1 },
    async (jobs) => {
      for (const job of jobs)
        await processAssistantRun(pool, provider, z.uuid().parse(job.data.runId));
    },
  );
  await boss.createQueue("assistant-dispatch", {
    retryLimit: 5,
    expireInSeconds: 60,
    policy: "singleton",
  });
  await boss.work("assistant-dispatch", { pollingIntervalSeconds: 1 }, async () => {
    const c = await pool.connect();
    try {
      await c.query("begin");
      const rows = (
        await c.query(
          "select * from outbox where event_type='ASSISTANT_RUN' and processed_at is null order by created_at limit 20 for update skip locked",
        )
      ).rows;
      for (const row of rows) {
        const runId = z.uuid().parse(row.payload_json.runId);
        await boss.send(
          "assistant-run",
          { runId },
          {
            id: row.id,
            singletonKey: runId,
            db: { executeSql: (text, values) => c.query(text, values) },
          },
        );
        await c.query("update outbox set processed_at=now() where id=$1", [row.id]);
      }
      await c.query("commit");
    } catch (error) {
      await c.query("rollback");
      throw error;
    } finally {
      c.release();
    }
  });
  await boss.schedule("assistant-dispatch", "* * * * *");
  await boss.send("assistant-dispatch");
}
