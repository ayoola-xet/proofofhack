import "dotenv/config";
import { setTimeout } from "node:timers/promises";
import { FileCiphertextStore } from "../../../packages/ciphertext-store/src/index.ts";
import { connectDatabase } from "../../../packages/database/src/index.ts";
import { sweepRetention } from "./process.ts";

if (!["local", "arc-testnet"].includes(process.env.APP_ENV ?? ""))
  throw new Error("Retention requires an explicit local or Arc Testnet environment.");
const { pool } = connectDatabase(),
  stores = {
    evidence: new FileCiphertextStore(
      process.env.EVIDENCE_DIRECTORY ?? ".local/ciphertext/evidence",
      262192,
    ),
    reports: new FileCiphertextStore(
      process.env.REPORT_DIRECTORY ?? ".local/ciphertext/reports",
      1048576,
    ),
  },
  stop = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => stop.abort());
try {
  do {
    try {
      const result = await sweepRetention(pool, stores);
      process.stdout.write(`${JSON.stringify({ service: "retention", ...result })}\n`);
      if (result.state !== "COMPLETE" && !process.argv.includes("--watch")) process.exitCode = 1;
    } catch {
      process.stderr.write(
        "Retention did not complete. Keep restored services offline until a complete scan passes.\n",
      );
      if (!process.argv.includes("--watch")) process.exitCode = 1;
    }
    if (!process.argv.includes("--watch")) break;
    await setTimeout(600000, undefined, { signal: stop.signal }).catch((error) => {
      if (error.name !== "AbortError") throw error;
    });
  } while (!stop.signal.aborted);
} finally {
  await pool.end();
}
