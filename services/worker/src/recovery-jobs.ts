import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import type { RecoveryScanner } from "../../../packages/chain/src/recovery.ts";
import { bytes32 } from "../../../packages/domain/src/index.ts";
import { processRecovery, type RecoveryRelayer } from "./recovery-process.ts";

export async function startRecoveryJobs(
  boss: PgBoss,
  pool: Pool,
  chain: RecoveryScanner,
  relayer: RecoveryRelayer,
) {
  await boss.createQueue("bounty-recovery", {
    retryLimit: 5,
    retryDelay: 10,
    retryBackoff: true,
    expireInSeconds: 540,
    policy: "singleton",
  });
  await boss.work<{ bountyId: string }>(
    "bounty-recovery",
    { pollingIntervalSeconds: 1 },
    async (jobs) => {
      for (const job of jobs)
        await processRecovery(pool, chain, relayer, bytes32.parse(job.data.bountyId));
    },
  );
  await boss.createQueue("recovery-dispatch", {
    retryLimit: 5,
    expireInSeconds: 60,
    policy: "singleton",
  });
  await boss.work("recovery-dispatch", { pollingIntervalSeconds: 1 }, async () => {
    const c = await pool.connect();
    try {
      await c.query("begin");
      const pending = (
        await c.query(
          "select * from outbox where event_type='RECOVERY_PROCESS' and processed_at is null order by created_at limit 50 for update skip locked",
        )
      ).rows;
      for (const row of pending) {
        const bountyId = bytes32.parse(row.payload_json.bountyId);
        const sent = await boss.send(
          "bounty-recovery",
          { bountyId },
          {
            id: row.id,
            singletonKey: bountyId,
            db: { executeSql: (text, values) => c.query(text, values) },
          },
        );
        if (sent) await c.query("update outbox set processed_at=now() where id=$1", [row.id]);
      }
      await c.query("commit");
    } catch (error) {
      await c.query("rollback");
      throw error;
    } finally {
      c.release();
    }
    const rows = (
      await pool.query(
        "select b.bounty_id from bounties b left join bounty_recovery r on r.bounty_id=b.bounty_id where r.bounty_id is null or (r.status not in('COMPLETE','NEEDS_REVIEW') and r.next_check_at<=now()) order by coalesce(r.next_check_at,b.created_at) limit 50",
      )
    ).rows;
    for (const row of rows)
      await boss.send(
        "bounty-recovery",
        { bountyId: row.bounty_id },
        { singletonKey: row.bounty_id },
      );
  });
  await boss.schedule("recovery-dispatch", "* * * * *");
  await boss.send("recovery-dispatch");
}
