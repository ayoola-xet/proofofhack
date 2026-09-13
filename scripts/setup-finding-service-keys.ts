import "dotenv/config";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { keccak256, toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { hashCanonical } from "../packages/crypto-envelope/src/index.ts";
import { publicConfigSchema } from "../packages/service-config/src/index.ts";

const root = ".local/keys";
async function secret(name: string, create: () => Promise<Record<string, unknown>>) {
  const path = `${root}/${name}.json`;
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const value = { testnetOnly: true, ...(await create()) };
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  return value;
}
async function required(name: string) {
  try {
    return JSON.parse(await readFile(`${root}/${name}.json`, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new Error(`Run setup-service-keys first (missing ${root}/${name}.json).`);
    throw error;
  }
}
const evidence = await required("verifier-encryption");
const identities: Record<string, string> = {};
for (const name of ["api", "worker", "verifier", "report-release"])
  identities[name] = (await required(`${name}-identity`)).publicKey;
const admission = await secret("admission-signing-finding", async () => {
  const privateKey = generatePrivateKey();
  return {
    purpose: "FINDING_ADMISSION_SIGNING",
    privateKey,
    address: privateKeyToAccount(privateKey).address.toLowerCase(),
  };
});
const verdict = await secret("verdict-signing-finding", async () => {
  const privateKey = generatePrivateKey();
  return {
    purpose: "FINDING_VERDICT_SIGNING",
    privateKey,
    address: privateKeyToAccount(privateKey).address.toLowerCase(),
  };
});
const adapterSources = [
  "services/verifier/src/finding.ts",
  "services/verifier/src/finding-process.ts",
  "packages/domain/src/index.ts",
  "packages/crypto-envelope/src/index.ts",
];
const sourceHashes = Object.fromEntries(
  await Promise.all(
    adapterSources.map(async (path) => [path, keccak256(toHex(await readFile(path, "utf8")))]),
  ),
);
const adapterCodeHash = hashCanonical({
  sources: sourceHashes,
  dependencies: { viem: "2.56.3", zod: "4.5.4" },
});
const verifierConfigHash = hashCanonical({
  adapterCodeHash,
  verifierMode: "AUTOMATED_SANDBOX_AND_AI",
  schemaVersion: "1",
});
const config = publicConfigSchema.parse({
  schemaVersion: "1",
  testnetOnly: true,
  evidenceScope: "AUTOMATED_FINDING",
  verifierMode: "AUTOMATED_SANDBOX_AND_AI",
  evidenceKeyId: keccak256(toHex(evidence.publicKey)),
  evidencePublicKey: evidence.publicKey,
  admissionSigner: admission.address,
  verdictSigner: verdict.address,
  adapterCodeHash,
  verifierConfigHash,
  serviceIdentities: identities,
});
try {
  const previous = publicConfigSchema.parse(
    JSON.parse(await readFile(".local/config/finding-public-services.json", "utf8")),
  );
  if (JSON.stringify(previous) !== JSON.stringify(config))
    throw new Error(
      "Findings public service configuration changed. Preserve the old verifier version before creating a new configuration.",
    );
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
await writeFile(
  ".local/config/finding-public-services.json",
  `${JSON.stringify(config, null, 2)}\n`,
  { mode: 0o600 },
);
const env = await readFile(".env", "utf8");
const line = "FINDING_SERVICE_PUBLIC_CONFIG=.local/config/finding-public-services.json";
await writeFile(
  ".env",
  /^FINDING_SERVICE_PUBLIC_CONFIG=.*$/m.test(env)
    ? env.replace(/^FINDING_SERVICE_PUBLIC_CONFIG=.*$/m, line)
    : `${env.trimEnd()}\n${line}\n`,
  { mode: 0o600 },
);
await chmod(".env", 0o600);
process.stdout.write(
  "Findings verifier testnet service keys and public configuration are ready. No private keys were printed.\n",
);
