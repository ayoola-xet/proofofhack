import { writeFile } from "node:fs/promises";
import { config } from "dotenv";

const services = {
  api: "../services/api/src/main.ts",
  worker: "../services/worker/src/main.ts",
  verifier: "../services/verifier/src/main.ts",
  reports: "../services/report-release/src/main.ts",
  retention: "../services/retention/src/main.ts",
  migrate: "../scripts/migrate.ts",
} as const;
const name = process.argv[2] as keyof typeof services;
if (!Object.hasOwn(services, name)) throw new Error("Select a supported container service.");
const loaded = config({ path: "/run/secrets/runtime.env", quiet: true });
if (loaded.error) throw new Error("The service environment file is not available.");
if (process.env.APP_ENV !== "arc-testnet")
  throw new Error("Deployment containers require Arc Testnet configuration.");
if (process.env.LOCAL_AUTH_FILE)
  throw new Error("Deployment containers cannot use local test identities.");
await import(services[name]);
if (name !== "migrate" && name !== "retention") await writeFile("/tmp/ready", name);
