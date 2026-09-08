import "dotenv/config";
import { FileCiphertextStore } from "../../../packages/ciphertext-store/src/index.ts";
import { connectDatabase } from "../../../packages/database/src/index.ts";
import { configuredPrivyAuth } from "../../../packages/privy/src/session-auth.ts";
import { loadPublicConfig } from "../../../packages/service-config/src/index.ts";
import { createReleaseApp } from "./app.ts";
import { createReportDownloadApp } from "./download.ts";
import { OrganizationKeyStore } from "./keys.ts";

const config = await loadPublicConfig(
  process.env.SERVICE_PUBLIC_CONFIG ?? ".local/config/public-services.json",
);
const { pool } = connectDatabase();
const app = createReleaseApp(
  pool,
  { api: config.serviceIdentities.api, worker: config.serviceIdentities.worker },
  process.env.REPORT_KEY_DIRECTORY ?? ".local/report-keys",
);
await app.listen({
  host: process.env.APP_ENV === "local" ? "127.0.0.1" : "0.0.0.0",
  port: Number(process.env.REPORT_INTERNAL_PORT ?? 4190),
});
const keys = new OrganizationKeyStore(process.env.REPORT_KEY_DIRECTORY ?? ".local/report-keys");
const downloads = createReportDownloadApp({
  pool,
  auth: configuredPrivyAuth(),
  mode: "organization",
  store: new FileCiphertextStore(
    process.env.REPORT_DIRECTORY ?? ".local/ciphertext/reports",
    1048576,
  ),
  resolveKey: async (id, org) => {
    const key = await keys.read(id);
    if (key.organizationId !== org)
      throw new Error("The report key belongs to another organization.");
    return key;
  },
});
await downloads.listen({
  host: process.env.APP_ENV === "local" ? "127.0.0.1" : "0.0.0.0",
  port: Number(process.env.ORGANIZATION_REPORT_PORT ?? 4193),
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, async () => {
    await app.close();
    await downloads.close();
    await pool.end();
  });
process.stdout.write("Report release service is ready.\n");
