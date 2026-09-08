import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import { z } from "zod";
import type { TreasuryProvider } from "../../../packages/privy/src/treasury.ts";
import { provisionTreasury } from "../../treasury/src/provision.ts";
export async function startTreasuryJobs(boss: PgBoss, pool: Pool, provider: TreasuryProvider) {
  await boss.createQueue("wallet-setup", {
    retryLimit: 8,
    retryDelay: 10,
    retryBackoff: true,
    expireInSeconds: 180,
    policy: "singleton",
  });
  await boss.createQueue("treasury-dispatch", {
    retryLimit: 5,
    expireInSeconds: 60,
    policy: "singleton",
  });
  await boss.work<{ setupId: string }>(
    "wallet-setup",
    { pollingIntervalSeconds: 1 },
    async (jobs) => {
      for (const job of jobs)
        await provisionTreasury(pool, provider, z.uuid().parse(job.data.setupId));
    },
  );
  await boss.work("treasury-dispatch", { pollingIntervalSeconds: 1 }, async () => {
    const c = await pool.connect();
    try {
      await c.query("begin");
      const rows = (
        await c.query(
          "select * from outbox where event_type='WALLET_SETUP' and processed_at is null order by created_at limit 50 for update skip locked",
        )
      ).rows;
      for (const row of rows) {
        const data = z.strictObject({ setupId: z.uuid() }).parse(row.payload_json);
        await boss.send("wallet-setup", data, {
          id: row.id,
          singletonKey: data.setupId,
          db: { executeSql: (text, values) => c.query(text, values) },
        });
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
  await boss.schedule("treasury-dispatch", "* * * * *");
  await boss.send("treasury-dispatch");
}
