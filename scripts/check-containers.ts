import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { IncomingHttpHeaders } from "node:http";
import https from "node:https";
import { resolve } from "node:path";

const root = resolve(".local/container-check");
const composeArgs = [
  "compose",
  "--project-name",
  "proofofhack-container-check",
  "--env-file",
  `${root}/compose.env`,
  "-f",
  "infra/deployment.compose.yaml",
];
function compose(args: string[]) {
  return execFileSync("docker", [...composeArgs, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30000,
  });
}
const cert = await readFile(`${root}/data/caddy-data/caddy/pki/authorities/local/root.crt`);
async function request(path: string) {
  return new Promise<{ status: number; body: string; headers: IncomingHttpHeaders }>(
    (resolve, reject) => {
      const req = https.get(
        `https://localhost:8443${path}`,
        { ca: cert, timeout: 5000 },
        (response) => {
          let body = "";
          response.setEncoding("utf8");
          response.on("data", (part) => {
            body += part;
          });
          response.on("end", () =>
            resolve({ status: response.statusCode ?? 0, body, headers: response.headers }),
          );
        },
      );
      req.on("timeout", () => req.destroy(new Error("Container request timed out.")));
      req.on("error", reject);
    },
  );
}
const checks: { id: string; result: "PASS"; detail: string }[] = [];
const images: Record<string, string> = {};
for (const name of ["api", "verifier", "reports", "worker", "retention", "gateway", "postgres"]) {
  const id = compose(["ps", "-q", name]).trim();
  assert(id, `${name} is not running.`);
  const info = JSON.parse(execFileSync("docker", ["inspect", id], { encoding: "utf8" }))[0];
  assert.equal(info.State.Running, true);
  images[name] = info.Image;
  if (info.State.Health)
    assert.equal(info.State.Health.Status, "healthy", `${name} is not healthy.`);
  if (name !== "postgres") {
    assert(info.Config.User && !["0", "root"].includes(info.Config.User.split(":")[0]));
    assert.equal(info.HostConfig.ReadonlyRootfs, true);
    assert(info.HostConfig.CapDrop.includes("ALL"));
  }
  if (name !== "gateway") assert.equal(Object.keys(info.HostConfig.PortBindings ?? {}).length, 0);
  checks.push({
    id: `CONTAINER_${name.toUpperCase()}`,
    result: "PASS",
    detail: "Running with the expected user, ports, root filesystem, and available health checks.",
  });
}
for (const [path, expected] of [
  ["/", 200],
  ["/receipts", 200],
  ["/api/v1/health", 200],
  ["/api/v1/me", 401],
  ["/private/researcher/reports/00000000-0000-4000-8000-000000000000", 401],
  ["/private/organization/reports/00000000-0000-4000-8000-000000000000", 401],
  ["/internal/assessments", 404],
  ["/internal/organization-keys", 404],
  ["/.env", 404],
  ["/.local/keys/verdict-signing.json", 404],
  ["/api/unknown", 404],
] as const) {
  const response = await request(path);
  assert.equal(response.status, expected, `${path} has an unexpected status.`);
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  if (path === "/") assert(response.body.includes('type="module"'));
  checks.push({
    id: `HTTPS_${path}`,
    result: "PASS",
    detail: `Verified local TLS certificate and HTTP ${expected}.`,
  });
}
function probe(service: string, source: string) {
  compose(["exec", "-T", service, "node", "--input-type=module", "-e", source]);
}
for (const [environment, message] of [
  ["APP_ENV=local", "Deployment containers require Arc Testnet configuration."],
  [
    "LOCAL_AUTH_FILE=/tmp/forbidden-local-identities.json",
    "Deployment containers cannot use local test identities.",
  ],
] as const) {
  let rejected = false;
  try {
    compose([
      "exec",
      "-T",
      "-e",
      environment,
      "api",
      "node",
      "--import",
      "tsx",
      "infra/container-entry.ts",
      "migrate",
    ]);
  } catch (error) {
    rejected = String((error as { stderr?: unknown }).stderr).includes(message);
  }
  assert(rejected, "The container environment guard did not reject an invalid setting.");
}
checks.push({
  id: "DEPLOYMENT_ENVIRONMENT_GUARDS",
  result: "PASS",
  detail: "The running image rejects local mode and local identity files before service import.",
});
const denied = (paths: string[]) =>
  `import fs from 'node:fs'; for(const p of ${JSON.stringify(paths)}) { try { fs.accessSync(p,fs.constants.R_OK); throw new Error('Unexpected access'); } catch(e) { if(!['ENOENT','EACCES'].includes(e.code)) throw e; } }`;
for (const service of ["api", "worker", "verifier", "reports", "retention"])
  probe(service, denied(["/app/.env", "/app/.git", "/app/evidence"]));
probe(
  "api",
  denied([
    "/app/.local/keys/verifier-encryption.json",
    "/run/secrets/privy-authorization.json",
    "/data/report-keys",
    "/data/reports",
    "/data/circle",
  ]),
);
probe(
  "worker",
  denied([
    "/app/.local/keys/verifier-encryption.json",
    "/data/evidence",
    "/data/reports",
    "/data/report-keys",
  ]),
);
probe(
  "verifier",
  denied(["/data/report-keys", "/data/circle", "/run/secrets/privy-authorization.json"]),
);
probe(
  "reports",
  denied(["/app/.local/keys/verifier-encryption.json", "/data/evidence", "/data/circle"]),
);
probe(
  "retention",
  denied([
    "/app/.local/keys/verifier-encryption.json",
    "/data/report-keys",
    "/run/secrets/privy-authorization.json",
  ]),
);
const name = `.container-probe-${randomUUID()}`;
try {
  probe(
    "api",
    `import fs from 'node:fs'; fs.writeFileSync('/data/evidence/${name}','permission probe',{mode:0o600,flag:'wx'});`,
  );
  probe(
    "verifier",
    `import fs from 'node:fs'; if(fs.readFileSync('/data/evidence/${name}','utf8')!=='permission probe') throw new Error('Read failed'); try { fs.writeFileSync('/data/evidence/${name}','changed'); throw new Error('Unexpected write'); } catch(e) { if(!['EROFS','EACCES'].includes(e.code)) throw e; }`,
  );
  probe(
    "verifier",
    `import fs from 'node:fs'; fs.writeFileSync('/data/reports/${name}','report probe',{mode:0o600,flag:'wx'});`,
  );
  probe(
    "reports",
    `import fs from 'node:fs'; if(fs.readFileSync('/data/reports/${name}','utf8')!=='report probe') throw new Error('Read failed'); try { fs.writeFileSync('/data/reports/${name}','changed'); throw new Error('Unexpected write'); } catch(e) { if(!['EROFS','EACCES'].includes(e.code)) throw e; }`,
  );
} finally {
  probe(
    "retention",
    `import fs from 'node:fs'; for(const dir of ['evidence','reports']) fs.rmSync('/data/'+dir+'/${name}',{force:true});`,
  );
}
checks.push({
  id: "SERVICE_FILE_BOUNDARIES",
  result: "PASS",
  detail:
    "Checked absent secret mounts, allowed ciphertext reads, rejected writes, and retention cleanup.",
});
const migrations = compose([
  "exec",
  "-T",
  "postgres",
  "psql",
  "-U",
  "proofofhack",
  "-d",
  "proofofhack",
  "-Atc",
  "select count(*) from drizzle.__drizzle_migrations",
]).trim();
assert.equal(migrations, "18");
checks.push({
  id: "SEPARATE_RELEASE_MIGRATIONS",
  result: "PASS",
  detail: "The separate database has all 18 migrations.",
});
await mkdir("evidence/local", { recursive: true });
await writeFile(
  "evidence/local/container-check.json",
  `${JSON.stringify(
    {
      schemaVersion: "1",
      scope: "LOCAL_DEPLOYMENT_CONTAINER_CHECK",
      capturedAt: new Date().toISOString(),
      baseCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      checks,
      images,
      limits: [
        "This is a separate local database with no bounty records.",
        "Circle, Privy signing, and model credentials are absent from this check.",
        "This check does not prove public hosting, browser login, financial execution, backups, or restore.",
      ],
    },
    null,
    2,
  )}\n`,
);
process.stdout.write(
  `Passed ${checks.length} local container checks. Public deployment remains unverified.\n`,
);
