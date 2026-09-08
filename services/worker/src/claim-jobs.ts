import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import { bytes32, DomainError } from "../../../packages/domain/src/index.ts";
import type { InternalClient } from "../../../packages/service-auth/src/http.ts";
import { type ClaimChain, type ClaimRelayer, processClaim } from "./claim-process.ts";

export async function startClaimJobs(
  boss: PgBoss,
  pool: Pool,
  chain: ClaimChain,
  relayer: ClaimRelayer,
  verifier: InternalClient,
  release: InternalClient,
) {
  await boss.createQueue("claim-process", {
    retryLimit: 8,
    retryDelay: 10,
    retryBackoff: true,
    expireInSeconds: 540,
    policy: "singleton",
  });
  await boss.work<{ claimId: string }>(
    "claim-process",
    { pollingIntervalSeconds: 1 },
    async (jobs) => {
      for (const job of jobs) {
        try {
          await processClaim(
            pool,
            chain,
            relayer,
            verifier,
            release,
            bytes32.parse(job.data.claimId),
          );
        } catch (error) {
          if (error instanceof DomainError && error.code === "INVALID_FIXTURE") continue;
          throw error;
        }
      }
    },
  );
  await boss.createQueue("claim-dispatch", {
    retryLimit: 5,
    expireInSeconds: 60,
    policy: "singleton",
  });
  await boss.work("claim-dispatch", { pollingIntervalSeconds: 1 }, async () => {
    const c = await pool.connect();
    try {
      await c.query("begin");
      const rows = (
        await c.query(
          "select * from outbox where event_type='CLAIM_PROCESS' and processed_at is null order by created_at limit 50 for update skip locked",
        )
      ).rows;
      for (const row of rows) {
        const claimId = bytes32.parse(row.payload_json.claimId);
        await boss.send(
          "claim-process",
          { claimId },
          {
            id: row.id,
            singletonKey: claimId,
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
  await boss.schedule("claim-dispatch", "* * * * *");
  await boss.send("claim-dispatch");
}
