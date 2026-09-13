import "dotenv/config";
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const args = process.argv.slice(2);
if (args.includes("--help")) {
  process.stdout.write(
    "Start the configured ProofOfHack services with pnpm dev. Use --check to check settings and ports without starting services.\n",
  );
  process.exit(0);
}
if (args.some((arg) => arg !== "--check")) throw new Error("Use pnpm dev or pnpm dev --check.");
if (process.platform === "win32")
  throw new Error("Use a Linux or macOS shell for the service supervisor.");
if (!["local", "arc-testnet"].includes(process.env.APP_ENV ?? ""))
  throw new Error("Set APP_ENV to local or arc-testnet before starting the services.");
const required = [
  "PRIVY_APP_ID",
  "PRIVY_APP_SECRET",
  "VITE_PRIVY_APP_ID",
  "GRAPH_ENDPOINT",
  "GRAPH_DEPLOYMENT_ID",
  "ESCROW_ADDRESS",
  "CIRCLE_AGENT_ADDRESS",
  "SERVICE_PUBLIC_CONFIG",
  "FINDING_SERVICE_PUBLIC_CONFIG",
];
const missing = required.filter((key) => !process.env[key]);
if (missing.length)
  throw new Error(`Configure these settings first: ${missing.join(", ")}. Values are not logged.`);
if (!existsSync(process.env.SERVICE_PUBLIC_CONFIG as string))
  throw new Error(
    "The public service configuration file is missing. Complete service key setup first.",
  );
if (!existsSync(process.env.FINDING_SERVICE_PUBLIC_CONFIG as string))
  throw new Error(
    "The findings public service configuration file is missing. Complete findings service key setup first.",
  );
const port = (key: string, fallback: number) => {
  const value = Number(process.env[key] ?? fallback);
  if (!Number.isInteger(value) || value < 1024 || value > 65535)
    throw new Error(`Use a port from 1024 to 65535 for ${key}.`);
  return value;
};
const services = [
  {
    name: "reports",
    entry: "services/report-release/src/main.ts",
    ports: [port("REPORT_INTERNAL_PORT", 4194), port("ORGANIZATION_REPORT_PORT", 4193)],
  },
  {
    name: "verifier",
    entry: "services/verifier/src/main.ts",
    ports: [port("VERIFIER_INTERNAL_PORT", 4191), port("RESEARCHER_REPORT_PORT", 4192)],
  },
  {
    name: "findings-verifier",
    entry: "services/verifier/src/finding-main.ts",
    ports: [port("FINDING_VERIFIER_INTERNAL_PORT", 4196)],
  },
  { name: "api", entry: "services/api/src/main.ts", ports: [port("API_PORT", 4187)] },
  { name: "worker", entry: "services/worker/src/main.ts", ports: [] },
  { name: "retention", entry: "services/retention/src/main.ts", ports: [], args: ["--watch"] },
  { name: "web", entry: "node_modules/vite/bin/vite.js", ports: [5173] },
];
const ports = services.flatMap((s) => s.ports);
if (new Set(ports).size !== ports.length)
  throw new Error("Each HTTP service needs a separate port.");
async function available(value: number) {
  await new Promise<void>((done, reject) => {
    const server = createServer();
    server.once("error", () =>
      reject(
        new Error(
          `Port ${value} is in use. Use the running app or stop its existing service before starting another copy.`,
        ),
      ),
    );
    server.listen(value, "127.0.0.1", () =>
      server.close((error) => (error ? reject(error) : done())),
    );
  });
}
await Promise.all(ports.map(available));
if (args.includes("--check")) {
  process.stdout.write(
    "Required settings and service ports are available. Provider access is checked when the services start.\n",
  );
  process.exit(0);
}
const children: ChildProcess[] = [];
let stopping = false;
async function stop(code: number) {
  if (stopping) return;
  stopping = true;
  const active = children.filter(
    (child) => child.pid !== undefined && child.exitCode === null && child.signalCode === null,
  );
  const signal = (child: ChildProcess, value: NodeJS.Signals) => {
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      try {
        process.kill(-child.pid, value);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH")
          process.stderr.write("A child service needs a manual status check.\n");
      }
    }
  };
  for (const child of active) signal(child, "SIGTERM");
  const timer = setTimeout(() => {
    for (const child of active) signal(child, "SIGKILL");
  }, 30000);
  await Promise.all(
    active.map(
      (child) =>
        new Promise<void>((done) => {
          if (child.exitCode !== null || child.signalCode !== null) done();
          else child.once("exit", () => done());
        }),
    ),
  );
  clearTimeout(timer);
  process.exitCode = code;
}
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void stop(0);
  });
process.stdout.write(
  "Starting the configured ProofOfHack services. Press Ctrl+C to stop this group.\n",
);
for (const service of services) {
  const argv =
    service.name === "web"
      ? [resolve(service.entry), "--host", "127.0.0.1"]
      : ["--import", "tsx", service.entry, ...(service.args ?? [])];
  const child = spawn(process.execPath, argv, {
    cwd: service.name === "web" ? resolve("apps/web") : process.cwd(),
    detached: true,
    stdio: "inherit",
  });
  children.push(child);
  child.once("error", () => {
    process.stderr.write(`The ${service.name} service could not start.\n`);
    void stop(1);
  });
  child.once("exit", (code) => {
    if (!stopping) {
      process.stderr.write(
        `The ${service.name} service stopped (${code ?? "signal"}). Stopping the other services in this group.\n`,
      );
      void stop(1);
    }
  });
}
async function listening(value: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${value}/`, {
      signal: AbortSignal.timeout(1000),
      redirect: "error",
    });
    await response.body?.cancel();
    return response.status < 500;
  } catch {
    return false;
  }
}

for (let attempt = 0; attempt < 120 && !stopping; attempt++) {
  if ((await Promise.all(ports.map(listening))).every(Boolean)) {
    process.stdout.write(
      "HTTP services are ready at http://127.0.0.1:5173. Check the worker startup message for provider readiness.\n",
    );
    break;
  }
  if (attempt === 119) {
    process.stderr.write("Service startup timed out.\n");
    await stop(1);
    break;
  }
  await delay(500);
}
