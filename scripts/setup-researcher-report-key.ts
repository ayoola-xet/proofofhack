import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createEncryptionKeyPair } from "../packages/crypto-envelope/src/index.ts";

if (!["local", "arc-testnet"].includes(process.env.APP_ENV ?? ""))
  throw new Error("Use a testnet environment.");
const path = ".local/keys/researcher-report-encryption.json";
await mkdir(".local/keys", { recursive: true, mode: 0o700 });
try {
  await readFile(path);
  console.log("The separate researcher report key already exists.");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  await writeFile(
    path,
    JSON.stringify({
      testnetOnly: true,
      purpose: "RESEARCHER_REPORT_DECRYPTION",
      ...(await createEncryptionKeyPair()),
    }),
    { mode: 0o600, flag: "wx" },
  );
  console.log("The separate researcher report key is ready.");
}
