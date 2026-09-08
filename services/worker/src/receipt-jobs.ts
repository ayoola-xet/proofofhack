import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import { z } from "zod";
import { type ExportChain, processReceiptExport } from "../../receipts/src/process.ts";
import { arcReceiptScope, type ReceiptScope } from "../../receipts/src/scope.ts";
export async function startReceiptExportJobs(
  boss: PgBoss,
  pool: Pool,
  chain: ExportChain,
  scope: ReceiptScope = arcReceiptScope,
) {
  await boss.createQueue("receipt-export", {
    retryLimit: 2,
    retryDelay: 10,
    expireInSeconds: 900,
    policy: "singleton",
  });
  await boss.work<{ exportId: string }>(
    "receipt-export",
    { pollingIntervalSeconds: 1 },
    async (jobs) => {
      for (const job of jobs)
        await processReceiptExport(pool, chain, z.uuid().parse(job.data.exportId), scope);
    },
  );
  await boss.createQueue("receipt-export-dispatch", {
    retryLimit: 5,
    expireInSeconds: 60,
    policy: "singleton",
  });
  await boss.work("receipt-export-dispatch", { pollingIntervalSeconds: 1 }, async () => {
    const rows = (
      await pool.query(
        "select id from receipt_exports where state in ('QUEUED','RETRYING') or (state='RUNNING' and updated_at<now()-interval '15 minutes') order by created_at limit 20",
      )
    ).rows;
    for (const row of rows)
      await boss.send("receipt-export", { exportId: row.id }, { singletonKey: row.id });
  });
  await boss.schedule("receipt-export-dispatch", "* * * * *");
  await boss.send("receipt-export-dispatch");
}
