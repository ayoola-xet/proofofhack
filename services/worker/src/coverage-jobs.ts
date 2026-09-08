import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import { z } from "zod";
import { type CoverageSource, refreshCoverage } from "../../coverage/src/refresh.ts";

export async function startCoverageJobs(boss: PgBoss, pool: Pool, source: CoverageSource) {
  await boss.createQueue("coverage-refresh", {
    retryLimit: 5,
    retryDelay: 10,
    retryBackoff: true,
    expireInSeconds: 120,
    policy: "singleton",
  });
  await boss.createQueue("coverage-sweep", {
    retryLimit: 3,
    expireInSeconds: 120,
    policy: "singleton",
  });
  await boss.createQueue("outbox-dispatch", {
    retryLimit: 5,
    retryDelay: 5,
    expireInSeconds: 120,
    policy: "singleton",
  });
  await boss.work<{ organizationId: string }>(
    "coverage-refresh",
    { pollingIntervalSeconds: 1 },
    async (jobs) => {
      for (const job of jobs) {
        const { organizationId } = z.strictObject({ organizationId: z.uuid() }).parse(job.data);
        await refreshCoverage(pool, source, organizationId);
      }
    },
  );
  await boss.work("coverage-sweep", async () => {
    let after: string | null = null;
    while (true) {
      const rows: { organization_id: string }[] = (
        await pool.query(
          "select distinct organization_id from registered_vaults where ($1::uuid is null or organization_id>$1) order by organization_id limit 100",
          [after],
        )
      ).rows;
      for (const row of rows)
        await boss.send(
          "coverage-refresh",
          { organizationId: row.organization_id },
          { singletonKey: row.organization_id },
        );
      if (rows.length < 100) break;
      after = rows[rows.length - 1].organization_id;
    }
  });
  await boss.work("outbox-dispatch", { pollingIntervalSeconds: 1 }, async () =>
    dispatchCoverageOutbox(boss, pool),
  );
  await boss.schedule("coverage-sweep", "* * * * *");
  await boss.schedule("outbox-dispatch", "* * * * *");
  await boss.send("outbox-dispatch");
  await boss.send("coverage-sweep");
}
export async function dispatchCoverageOutbox(boss: PgBoss, pool: Pool) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    const rows = (
      await c.query(
        "select * from outbox where processed_at is null and event_type='COVERAGE_REFRESH' order by created_at limit 100 for update skip locked",
      )
    ).rows;
    for (const row of rows) {
      const data = z.strictObject({ organizationId: z.uuid() }).parse(row.payload_json);
      await boss.send("coverage-refresh", data, {
        id: row.id,
        singletonKey: data.organizationId,
        db: { executeSql: (text: string, values?: unknown[]) => c.query(text, values) },
      });
      await c.query("update outbox set processed_at=now() where id=$1", [row.id]);
    }
    await c.query("commit");
    return { dispatched: rows.length };
  } catch (error) {
    await c.query("rollback");
    throw error;
  } finally {
    c.release();
  }
}
