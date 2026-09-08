import "dotenv/config";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";

const key = z.string().min(20).parse(process.env.GRAPH_DEPLOY_KEY);
const version = z
  .string()
  .regex(/^v[0-9]+\.[0-9]+\.[0-9]+$/)
  .parse(process.argv[2] ?? "v0.1.0");
const args = [
  "exec",
  "graph",
  "deploy",
  "vuln-proof-coverage",
  "subgraph.yaml",
  "--node",
  "https://api.studio.thegraph.com/deploy/",
  "--deploy-key",
  key,
  "--version-label",
  version,
];
const child = spawn("pnpm", args, {
  cwd: "packages/erc4626-coverage-data",
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
for (const stream of [child.stdout, child.stderr])
  stream.on("data", (chunk) => {
    const text = String(chunk).replaceAll(key, "[redacted]");
    log += text;
    process.stdout.write(text);
  });
const code = await new Promise<number>((resolve) => {
  child.on("error", () => resolve(1));
  child.on("close", (code) => resolve(code ?? 1));
});
await mkdir(".local", { recursive: true, mode: 0o700 });
await writeFile(".local/graph-deploy.log", log, { mode: 0o600 });
process.exitCode = code;
