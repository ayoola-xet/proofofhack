import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import { z } from "zod";
import { ArcFundingChain } from "../../../packages/chain/src/funding.ts";
import type { TreasuryProvider } from "../../../packages/privy/src/treasury.ts";
import { fundBounty } from "../../treasury/src/fund.ts";
import { provisionTreasury } from "../../treasury/src/provision.ts";
export async function startTreasuryJobs(boss: PgBoss, pool: Pool, provider: TreasuryProvider) {
  await boss.createQueue("bounty-funding", {
    retryLimit: 5,
    retryDelay: 10,
    retryBackoff: true,
    expireInSeconds: 180,
    policy: "singleton",
  });
  const chain = new ArcFundingChain();
  await boss.work<{ fundingId: string }>(
    "bounty-funding",
    { pollingIntervalSeconds: 1 },
    async (jobs) => {
      for (const job of jobs) {
        const result = await fundBounty(pool, provider, chain, z.uuid().parse(job.data.fundingId));
        if (result.state.startsWith("CONFIRMING"))
          throw new Error("The saved transaction awaits a final receipt.");
      }
    },
  );
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
          "select * from outbox where event_type in('WALLET_SETUP','BOUNTY_FUNDING') and processed_at is null order by created_at limit 50 for update skip locked",
        )
      ).rows;
      for (const row of rows) {
        const isFunding = row.event_type === "BOUNTY_FUNDING";
        const data = isFunding
          ? z.strictObject({ fundingId: z.uuid() }).parse(row.payload_json)
          : z.strictObject({ setupId: z.uuid() }).parse(row.payload_json);
        await boss.send(isFunding ? "bounty-funding" : "wallet-setup", data, {
          id: row.id,
          singletonKey: "fundingId" in data ? data.fundingId : data.setupId,
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
