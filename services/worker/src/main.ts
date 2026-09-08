import { z } from "zod";
import { PrivyTreasury } from "../../../packages/privy/src/treasury.ts";
import { loadTestnetSecret } from "../../../packages/service-config/src/index.ts";
import { startTreasuryJobs } from "./treasury-jobs.ts";
import "dotenv/config";
import { PgBoss } from "pg-boss";
import { connectDatabase, databaseUrl } from "../../../packages/database/src/index.ts";
import { GraphCoverageClient } from "../../../packages/erc4626-coverage-data/src/client.ts";
import { startCoverageJobs } from "./coverage-jobs.ts";

const endpoint = process.env.GRAPH_ENDPOINT;
const deployment = process.env.GRAPH_DEPLOYMENT_ID;
if (!endpoint || !deployment) throw new Error("Configure the live Graph endpoint and deployment.");
const { pool } = connectDatabase();
const boss = new PgBoss(databaseUrl());
boss.on("error", () =>
  process.stderr.write("Worker operation failed. The durable job can retry.\n"),
);
await boss.start();
await startCoverageJobs(
  boss,
  pool,
  new GraphCoverageClient(endpoint, deployment, process.env.GRAPH_QUERY_KEY),
);
if (process.env.PRIVY_APP_ID && process.env.PRIVY_APP_SECRET) {
  const key = z
    .object({
      publicKey: z.string(),
      privateKey: z.string(),
      purpose: z.literal("PRIVY_ORGANIZATION_AUTHORIZATION"),
    })
    .parse(
      await loadTestnetSecret(
        process.env.PRIVY_AUTHORIZATION_KEY ?? ".local/keys/privy-authorization.json",
      ),
    );
  await startTreasuryJobs(
    boss,
    pool,
    new PrivyTreasury(process.env.PRIVY_APP_ID, process.env.PRIVY_APP_SECRET, key),
  );
}
process.stdout.write("Coverage and treasury workers are ready.\n");
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, async () => {
    await boss.stop({ graceful: true, timeout: 20_000 });
    await pool.end();
    process.exit(0);
  });
