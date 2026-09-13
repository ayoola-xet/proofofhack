import { z } from "zod";
import { ReadOnlyBountyChain } from "../../../packages/chain/src/bounty-reader.ts";
import { ReadOnlyBudgetChain } from "../../../packages/chain/src/budget.ts";
import { CircleBudgetExecutor } from "../../../packages/circle/src/budget.ts";
import { configuredCircleRelayer } from "../../../packages/circle/src/claims.ts";
import {
  ADAPTER_ID,
  address,
  GENERAL_FINDING_ADAPTER_ID,
} from "../../../packages/domain/src/index.ts";
import { PrivyTreasury } from "../../../packages/privy/src/treasury.ts";
import { PrivyWalletIdentity } from "../../../packages/privy/src/wallets.ts";
import { InternalClient } from "../../../packages/service-auth/src/http.ts";
import { loadTestnetSecret } from "../../../packages/service-config/src/index.ts";
import { configuredExplanationProvider } from "../../assistant/src/provider.ts";
import { startAssistantJobs } from "./assistant-jobs.ts";
import { startBudgetJobs } from "./budget-jobs.ts";
import { startClaimJobs } from "./claim-jobs.ts";
import { startOwnerJobs } from "./owner-jobs.ts";
import { startReceiptExportJobs } from "./receipt-jobs.ts";
import { startRecoveryJobs } from "./recovery-jobs.ts";
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
const coverageSource = new GraphCoverageClient(endpoint, deployment, process.env.GRAPH_QUERY_KEY);
await startCoverageJobs(boss, pool, coverageSource);
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
  const treasury = new PrivyTreasury(process.env.PRIVY_APP_ID, process.env.PRIVY_APP_SECRET, key);
  await startTreasuryJobs(boss, pool, treasury);
  if (process.env.ESCROW_ADDRESS)
    await startOwnerJobs(
      boss,
      pool,
      treasury,
      new ReadOnlyBudgetChain(
        "https://rpc.testnet.arc.io",
        5042002,
        address.parse(process.env.ESCROW_ADDRESS),
      ),
      new PrivyWalletIdentity(process.env.PRIVY_APP_ID, process.env.PRIVY_APP_SECRET),
    );
}
if (process.env.CIRCLE_AGENT_ADDRESS && process.env.ESCROW_ADDRESS) {
  const escrow = address.parse(process.env.ESCROW_ADDRESS);
  const operator = address.parse(process.env.CIRCLE_AGENT_ADDRESS);
  const relayer = await configuredCircleRelayer(pool, operator, escrow);
  const findingRelayer = process.env.FINDING_CIRCLE_AGENT_ADDRESS
    ? await configuredCircleRelayer(
        pool,
        address.parse(process.env.FINDING_CIRCLE_AGENT_ADDRESS),
        escrow,
      )
    : relayer;
  await startReceiptExportJobs(
    boss,
    pool,
    new ReadOnlyBountyChain("https://rpc.testnet.arc.io", 5042002, escrow),
  );
  await startRecoveryJobs(
    boss,
    pool,
    new ReadOnlyBountyChain("https://rpc.testnet.arc.io", 5042002, escrow),
    relayer,
  );
  await startBudgetJobs(
    boss,
    pool,
    new ReadOnlyBudgetChain("https://rpc.testnet.arc.io", 5042002, escrow),
    new CircleBudgetExecutor(relayer.walletId, operator, escrow),
    coverageSource,
  );
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
    { [ADAPTER_ID]: relayer, [GENERAL_FINDING_ADAPTER_ID]: findingRelayer },
    {
      [ADAPTER_ID]: new InternalClient(
        process.env.VERIFIER_INTERNAL_URL ?? "http://127.0.0.1:4191",
        "worker",
        "verifier",
        identity.privateKey,
      ),
      [GENERAL_FINDING_ADAPTER_ID]: new InternalClient(
        process.env.FINDING_VERIFIER_INTERNAL_URL ?? "http://127.0.0.1:4196",
        "worker",
        "finding-verifier",
        identity.privateKey,
      ),
    },
    new InternalClient(
      process.env.REPORT_INTERNAL_URL ?? "http://127.0.0.1:4194",
      "worker",
      "report-release",
      identity.privateKey,
    ),
  );
}
const explanationProvider = configuredExplanationProvider();
if (explanationProvider) await startAssistantJobs(boss, pool, explanationProvider);
process.stdout.write(
  "Configured coverage, treasury, owner, budget, claim, recovery, and assistant workers are ready.\n",
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, async () => {
    await boss.stop({ graceful: true, timeout: 20_000 });
    await pool.end();
    process.exit(0);
  });
