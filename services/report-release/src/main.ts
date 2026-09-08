import "dotenv/config";
import { connectDatabase } from "../../../packages/database/src/index.ts";
import { loadPublicConfig } from "../../../packages/service-config/src/index.ts";
import { createReleaseApp } from "./app.ts";

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
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, async () => {
    await app.close();
    await pool.end();
  });
process.stdout.write("Report release service is ready.\n");
