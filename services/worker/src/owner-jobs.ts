import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import { z } from "zod";
import type { BudgetChain } from "../../../packages/chain/src/budget.ts";
import { ArcFundingChain } from "../../../packages/chain/src/funding.ts";
import type { WalletIdentityProvider } from "../../../packages/privy/src/wallets.ts";
import { type OwnerProvider, processOwnerRequest } from "../../budget/src/owner-process.ts";

export async function startOwnerJobs(
  boss: PgBoss,
  pool: Pool,
  provider: OwnerProvider,
  controllerChain: BudgetChain,
  identities: WalletIdentityProvider,
) {
  const chain = new ArcFundingChain();
  await boss.createQueue("controller-owner", {
    retryLimit: 8,
    retryDelay: 10,
    retryBackoff: true,
    expireInSeconds: 300,
    policy: "singleton",
  });
  await boss.work<{ requestId: string }>(
    "controller-owner",
    { pollingIntervalSeconds: 1 },
    async (jobs) => {
      for (const job of jobs)
        await processOwnerRequest(
          pool,
          provider,
          chain,
          controllerChain,
          identities,
          z.uuid().parse(job.data.requestId),
        );
    },
  );
  await boss.createQueue("owner-dispatch", {
    retryLimit: 5,
    expireInSeconds: 60,
    policy: "singleton",
  });
  await boss.work("owner-dispatch", { pollingIntervalSeconds: 1 }, async () => {
    const c = await pool.connect();
    try {
      await c.query("begin");
      const rows = (
        await c.query(
          "select * from outbox where event_type='OWNER_ACTION' and processed_at is null order by created_at limit 50 for update skip locked",
        )
      ).rows;
      for (const row of rows) {
        const data = z.strictObject({ requestId: z.uuid() }).parse(row.payload_json);
        const job = await boss.send("controller-owner", data, {
          id: row.id,
          singletonKey: data.requestId,
          db: { executeSql: (text, values) => c.query(text, values) },
        });
        if (job) await c.query("update outbox set processed_at=now() where id=$1", [row.id]);
      }
      await c.query("commit");
    } catch (error) {
      await c.query("rollback");
      throw error;
    } finally {
      c.release();
    }
  });
  await boss.schedule("owner-dispatch", "* * * * *");
  await boss.send("owner-dispatch");
}
