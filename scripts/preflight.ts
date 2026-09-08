import "dotenv/config";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const checks: { name: string; status: string }[] = [];
for (const binary of ["node", "pnpm", "forge", "docker"]) {
  try {
    execFileSync(binary, ["--version"], { stdio: "pipe" });
    checks.push({ name: binary, status: "AVAILABLE" });
  } catch {
    checks.push({ name: binary, status: "MISSING" });
  }
}
checks.push({ name: "Local environment file", status: existsSync(".env") ? "PRESENT" : "MISSING" });
for (const [name, keys] of Object.entries({
  Privy: ["PRIVY_APP_ID", "PRIVY_APP_SECRET"],
  Graph: ["GRAPH_ENDPOINT", "GRAPH_API_KEY"],
  Circle: ["CIRCLE_WALLET_ID"],
  Model: ["MODEL_API_KEY", "MODEL_ID"],
  Settlement: ["ESCROW_ADDRESS", "RELAYER_PRIVATE_KEY"],
})) {
  checks.push({
    name,
    status: keys.every((key) => process.env[key]) ? "CONFIGURED_NOT_VERIFIED" : "NOT_CONFIGURED",
  });
}
console.table(checks);
console.log("Configuration presence does not prove a live integration.");
if (checks.some((check) => check.status === "MISSING" && check.name !== "Local environment file"))
  process.exitCode = 1;
