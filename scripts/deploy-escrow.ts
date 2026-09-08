import "dotenv/config";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createPublicClient, type Hex, http, keccak256 } from "viem";
import { address } from "../packages/domain/src/index.ts";

const operator = address.parse(process.env.CIRCLE_AGENT_ADDRESS);
const client = createPublicClient({ transport: http("https://rpc.testnet.arc.io") });
if ((await client.getChainId()) !== 5042002) throw new Error("Deployment requires Arc Testnet.");
const artifact = JSON.parse(
  await readFile("contracts/out/BountyEscrow.sol/BountyEscrow.json", "utf8"),
);
const bytecode = artifact.bytecode.object as Hex;
const hash = keccak256(bytecode);
await mkdir(".local/deployment-intents", { recursive: true, mode: 0o700 });
const path = ".local/deployment-intents/escrow.json";
let intent: { id: string; bytecodeHash: string; operator: string };
try {
  intent = JSON.parse(await readFile(path, "utf8"));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  intent = { id: randomUUID(), bytecodeHash: hash, operator };
  await writeFile(path, JSON.stringify(intent), { mode: 0o600, flag: "wx" });
}
if (intent.bytecodeHash !== hash || intent.operator !== operator)
  throw new Error("The existing deployment intent has different inputs.");
const args = [
  "exec",
  "circle",
  "contract",
  "deploy",
  "--bytecode",
  bytecode,
  "--address",
  operator,
  "--chain",
  "ARC-TESTNET",
  "--constructor-signature",
  "constructor(address)",
  "0x3600000000000000000000000000000000000000",
  "--idempotency-key",
  intent.id,
  "--output",
  "json",
];
const child = spawn("pnpm", args, { stdio: ["ignore", "pipe", "pipe"] });
let output = "";
for (const stream of [child.stdout, child.stderr])
  stream.on("data", (chunk) => {
    output += String(chunk);
  });
const code = await new Promise<number>((resolve) => {
  child.on("error", () => resolve(1));
  child.on("close", (code) => resolve(code ?? 1));
});
await writeFile(".local/deployment-intents/escrow-result.json", output, { mode: 0o600 });
process.stdout.write(
  code === 0
    ? "Arc escrow deployment request completed.\n"
    : "Arc escrow deployment request needs review.\n",
);
process.exitCode = code;
