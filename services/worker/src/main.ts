import { z } from "zod";
import { ReadOnlyBountyChain } from "../../../packages/chain/src/bounty-reader.ts";
import { configuredCircleRelayer } from "../../../packages/circle/src/claims.ts";
import { address } from "../../../packages/domain/src/index.ts";
import { PrivyTreasury } from "../../../packages/privy/src/treasury.ts";
import { InternalClient } from "../../../packages/service-auth/src/http.ts";
import { loadTestnetSecret } from "../../../packages/service-config/src/index.ts";
import { configuredExplanationProvider } from "../../assistant/src/provider.ts";
import { startAssistantJobs } from "./assistant-jobs.ts";
import { startClaimJobs } from "./claim-jobs.ts";
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
if (process.env.CIRCLE_AGENT_ADDRESS && process.env.ESCROW_ADDRESS) {
  const escrow = address.parse(process.env.ESCROW_ADDRESS);
  const identity = z
    .object({ privateKey: z.string().startsWith("-----BEGIN PRIVATE KEY-----") })
    .parse(
      await loadTestnetSecret(
        process.env.WORKER_IDENTITY_KEY ?? ".local/keys/worker-identity.json",
      ),
    );
  await startClaimJobs(
    boss,
    pool,
    new ReadOnlyBountyChain("https://rpc.testnet.arc.io", 5042002, escrow),
    await configuredCircleRelayer(pool, address.parse(process.env.CIRCLE_AGENT_ADDRESS), escrow),
    new InternalClient(
      process.env.VERIFIER_INTERNAL_URL ?? "http://127.0.0.1:4191",
      "worker",
      "verifier",
      identity.privateKey,
    ),
    new InternalClient(
      process.env.REPORT_INTERNAL_URL ?? "http://127.0.0.1:4190",
      "worker",
      "report-release",
      identity.privateKey,
    ),
  );
}
const explanationProvider = configuredExplanationProvider();
if (explanationProvider) await startAssistantJobs(boss, pool, explanationProvider);
process.stdout.write("Configured coverage, treasury, claim, and assistant workers are ready.\n");
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, async () => {
    await boss.stop({ graceful: true, timeout: 20_000 });
    await pool.end();
    process.exit(0);
  });
