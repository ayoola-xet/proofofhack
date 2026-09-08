import { randomBytes } from "node:crypto";
import { chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "dotenv";
import { z } from "zod";

const root = resolve(".local/container-check");
const secrets = `${root}/secrets`,
  data = `${root}/data`;
const current = parse(await readFile(".env"));
const appId = z
  .string()
  .regex(/^[a-z0-9]+$/)
  .parse(current.PRIVY_APP_ID);
const escrow = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .parse(current.ESCROW_ADDRESS);
for (const directory of [
  root,
  secrets,
  data,
  ...["evidence", "reports", "report-keys", "circle", "caddy-data", "caddy-config"].map(
    (name) => `${data}/${name}`,
  ),
])
  await mkdir(directory, { recursive: true, mode: 0o700 });
async function save(name: string, value: string) {
  await writeFile(`${secrets}/${name}`, value, { mode: 0o600, flag: "wx" }).catch((error) => {
    if (error.code !== "EEXIST") throw error;
  });
}
await save("database-password", randomBytes(32).toString("hex"));
const password = (await readFile(`${secrets}/database-password`, "utf8")).trim();
const database = `DATABASE_URL=postgres://vulnproof:${password}@postgres:5432/vulnproof\n`;
await save("database.env", database);
await save(
  "api.env",
  `${database}PRIVY_APP_ID=${appId}\nESCROW_ADDRESS=${escrow}\nWEB_ORIGIN=https://localhost:8443\n`,
);
await save("verifier.env", `${database}PRIVY_APP_ID=${appId}\nESCROW_ADDRESS=${escrow}\n`);
await save("reports.env", `${database}PRIVY_APP_ID=${appId}\n`);
const endpoint = z.url().parse(current.GRAPH_ENDPOINT),
  deployment = z
    .string()
    .regex(/^[a-zA-Z0-9]+$/)
    .parse(current.GRAPH_DEPLOYMENT_ID);
await save(
  "worker.env",
  `${database}GRAPH_ENDPOINT=${endpoint}\nGRAPH_DEPLOYMENT_ID=${deployment}\n`,
);
for (const name of [
  "api-identity",
  "worker-identity",
  "verifier-encryption",
  "researcher-report-encryption",
  "admission-signing",
  "verdict-signing",
]) {
  await copyFile(`.local/keys/${name}.json`, `${secrets}/${name}.json`, 1).catch((error) => {
    if (error.code !== "EEXIST") throw error;
  });
  await chmod(`${secrets}/${name}.json`, 0o600);
}
await save(
  "privy-authorization.json",
  JSON.stringify({ testnetOnly: true, purpose: "CONTAINER_CHECK_ONLY" }),
);
await save("public-services.json", await readFile(".local/config/public-services.json", "utf8"));
await writeFile(
  `${root}/compose.env`,
  [
    `DEPLOY_SECRETS=${secrets}`,
    `DEPLOY_DATA=${data}`,
    `SERVICE_UID=${process.getuid?.() ?? 1000}`,
    `SERVICE_GID=${process.getgid?.() ?? 1000}`,
    `VITE_PRIVY_APP_ID=${appId}`,
    "SITE_ADDRESS=localhost",
    "BIND_ADDRESS=127.0.0.1",
    "HTTP_PORT=8080",
    "HTTPS_PORT=8443",
    "RELEASE_TAG=local",
    "",
  ].join("\n"),
  { mode: 0o600 },
);
process.stdout.write(
  "Prepared a separate local container check. No Circle session or Privy signing credential is included.\n",
);
