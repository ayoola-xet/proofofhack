import { readFile } from "node:fs/promises";
import { z } from "zod";
import { address, bytes32 } from "../../domain/src/index.ts";
export const publicConfigSchema = z.strictObject({
  schemaVersion: z.literal("1"),
  testnetOnly: z.literal(true),
  evidenceScope: z.enum(["FIXTURE_ONLY", "AUTOMATED_FINDING"]),
  verifierMode: z.enum(["TRUSTED_SERVICE", "AUTOMATED_SANDBOX_AND_AI"]),
  evidenceKeyId: bytes32,
  evidencePublicKey: z.string().min(40).max(100),
  admissionSigner: address,
  verdictSigner: address,
  adapterCodeHash: bytes32,
  verifierConfigHash: bytes32,
  serviceIdentities: z.record(
    z.enum(["api", "worker", "verifier", "report-release"]),
    z.string().startsWith("-----BEGIN PUBLIC KEY-----"),
  ),
});
export type PublicServiceConfig = z.infer<typeof publicConfigSchema>;
export async function loadPublicConfig(path: string) {
  if (process.env.APP_ENV && !["local", "arc-testnet"].includes(process.env.APP_ENV))
    throw new Error("Use a configured testnet environment.");
  return publicConfigSchema.parse(JSON.parse(await readFile(path, "utf8")));
}
export async function loadTestnetSecret(path: string) {
  const secret = z
    .object({ testnetOnly: z.literal(true), purpose: z.string() })
    .passthrough()
    .parse(JSON.parse(await readFile(path, "utf8")));
  if (process.env.APP_ENV && !["local", "arc-testnet"].includes(process.env.APP_ENV))
    throw new Error("Testnet keys cannot run in this environment.");
  return secret;
}
