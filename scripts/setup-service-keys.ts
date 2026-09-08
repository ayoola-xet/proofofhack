import "dotenv/config";
import { generateKeyPairSync } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { keccak256, toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createEncryptionKeyPair, hashCanonical } from "../packages/crypto-envelope/src/index.ts";
import { publicConfigSchema } from "../packages/service-config/src/index.ts";

const root = ".local/keys";
await mkdir(root, { recursive: true, mode: 0o700 });
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
const evidence = await secret("verifier-encryption", async () => ({
  purpose: "EVIDENCE_DECRYPTION",
  ...(await createEncryptionKeyPair()),
}));
const admission = await secret("admission-signing", async () => {
  const privateKey = generatePrivateKey();
  return {
    purpose: "ADMISSION_SIGNING",
    privateKey,
    address: privateKeyToAccount(privateKey).address.toLowerCase(),
  };
});
const verdict = await secret("verdict-signing", async () => {
  const privateKey = generatePrivateKey();
  return {
    purpose: "VERDICT_SIGNING",
    privateKey,
    address: privateKeyToAccount(privateKey).address.toLowerCase(),
  };
});
const identities: Record<string, string> = {};
for (const name of ["api", "worker", "verifier", "report-release"]) {
  const pair = await secret(`${name}-identity`, async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    return {
      purpose: `SERVICE_IDENTITY:${name}`,
      privateKey: privateKey.export({ type: "pkcs8", format: "pem" }),
      publicKey: publicKey.export({ type: "spki", format: "pem" }),
    };
  });
  identities[name] = pair.publicKey;
}
const adapterSources = [
  "services/verifier/src/fixture.ts",
  "packages/domain/src/fixture-leaf.ts",
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
  dependencies: { viem: "2.56.3", zod: "4.5.4", merkleTree: "1.0.8", libsodium: "0.8.4" },
});
const verifierConfigHash = hashCanonical({
  adapterCodeHash,
  evidenceScope: "FIXTURE_ONLY",
  verifierMode: "TRUSTED_SERVICE",
  maximumEvidenceBytes: "262144",
  schemaVersion: "1",
});
const config = publicConfigSchema.parse({
  schemaVersion: "1",
  testnetOnly: true,
  evidenceScope: "FIXTURE_ONLY",
  verifierMode: "TRUSTED_SERVICE",
  evidenceKeyId: keccak256(toHex(evidence.publicKey)),
  evidencePublicKey: evidence.publicKey,
  admissionSigner: admission.address,
  verdictSigner: verdict.address,
  adapterCodeHash,
  verifierConfigHash,
  serviceIdentities: identities,
});
await mkdir(".local/config", { recursive: true, mode: 0o700 });
try {
  const previous = publicConfigSchema.parse(
    JSON.parse(await readFile(".local/config/public-services.json", "utf8")),
  );
  if (JSON.stringify(previous) !== JSON.stringify(config))
    throw new Error(
      "Public service configuration changed. Preserve the old verifier version before creating a new configuration.",
    );
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
await writeFile(".local/config/public-services.json", `${JSON.stringify(config, null, 2)}\n`, {
  mode: 0o600,
});
const env = await readFile(".env", "utf8");
const line = "SERVICE_PUBLIC_CONFIG=.local/config/public-services.json";
await writeFile(
  ".env",
  /^SERVICE_PUBLIC_CONFIG=.*$/m.test(env)
    ? env.replace(/^SERVICE_PUBLIC_CONFIG=.*$/m, line)
    : `${env.trimEnd()}\n${line}\n`,
  { mode: 0o600 },
);
await chmod(".env", 0o600);
process.stdout.write(
  "Separate testnet service keys and public configuration are ready. No private keys were printed.\n",
);
