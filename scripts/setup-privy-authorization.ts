import "dotenv/config";
import { generateKeyPairSync } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const path = ".local/keys/privy-authorization.json";
await mkdir(".local/keys", { recursive: true, mode: 0o700 });
try {
  await readFile(path);
  process.stdout.write("The Privy authorization key already exists.\n");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  await writeFile(
    path,
    JSON.stringify({
      testnetOnly: true,
      purpose: "PRIVY_ORGANIZATION_AUTHORIZATION",
      publicKey: keys.publicKey.export({ type: "spki", format: "der" }).toString("base64"),
      privateKey: keys.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
    }),
    { flag: "wx", mode: 0o600 },
  );
  process.stdout.write("A separate Privy authorization key is ready.\n");
}
