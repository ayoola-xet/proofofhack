import "dotenv/config";
import { readFile } from "node:fs/promises";
import { keccak256, toHex } from "viem";
import { z } from "zod";
import { ReadOnlyBountyChain } from "../../../packages/chain/src/bounty-reader.ts";
import { FileCiphertextStore } from "../../../packages/ciphertext-store/src/index.ts";
import { hashCanonical } from "../../../packages/crypto-envelope/src/index.ts";
import { connectDatabase } from "../../../packages/database/src/index.ts";
import { address, bytes32 } from "../../../packages/domain/src/index.ts";
import { configuredPrivyAuth } from "../../../packages/privy/src/session-auth.ts";
import { loadPublicConfig, loadTestnetSecret } from "../../../packages/service-config/src/index.ts";
import { createReportDownloadApp } from "../../report-release/src/download.ts";
import { createVerifierApp } from "./app.ts";
import { FixtureVerifier } from "./process.ts";

const config = await loadPublicConfig(
  process.env.SERVICE_PUBLIC_CONFIG ?? ".local/config/public-services.json",
);
const paths = [
  "services/verifier/src/fixture.ts",
  "packages/domain/src/fixture-leaf.ts",
  "packages/domain/src/index.ts",
  "packages/crypto-envelope/src/index.ts",
];
const sources = Object.fromEntries(
  await Promise.all(
    paths.map(async (path) => [path, keccak256(toHex(await readFile(path, "utf8")))]),
  ),
);
if (
  hashCanonical({
    sources,
    dependencies: { viem: "2.56.3", zod: "4.5.4", merkleTree: "1.0.8", libsodium: "0.8.4" },
  }) !== config.adapterCodeHash
)
  throw new Error("The running fixture adapter differs from its published code commitment.");
const keys = async (path: string, purpose: string) =>
  z
    .object({ publicKey: z.string(), privateKey: z.string(), purpose: z.literal(purpose) })
    .parse(await loadTestnetSecret(path));
const evidenceKeys = await keys(".local/keys/verifier-encryption.json", "EVIDENCE_DECRYPTION"),
  researcherKeys = await keys(
    ".local/keys/researcher-report-encryption.json",
    "RESEARCHER_REPORT_DECRYPTION",
  );
const signer = async (path: string, purpose: string) =>
  z
    .object({ privateKey: bytes32, purpose: z.literal(purpose) })
    .parse(await loadTestnetSecret(path)).privateKey;
const { pool } = connectDatabase(),
  reports = new FileCiphertextStore(
    process.env.REPORT_DIRECTORY ?? ".local/ciphertext/reports",
    1048576,
  );
const verifier = new FixtureVerifier(pool, {
  config,
  evidence: new FileCiphertextStore(
    process.env.EVIDENCE_DIRECTORY ?? ".local/ciphertext/evidence",
    262192,
  ),
  reports,
  reader: new ReadOnlyBountyChain(
    "https://rpc.testnet.arc.io",
    5042002,
    address.parse(process.env.ESCROW_ADDRESS),
  ),
  evidenceKeys,
  researcherKeys,
  admissionKey: await signer(".local/keys/admission-signing.json", "ADMISSION_SIGNING"),
  verdictKey: await signer(".local/keys/verdict-signing.json", "VERDICT_SIGNING"),
});
const internal = createVerifierApp(verifier, config.serviceIdentities.worker);
const downloads = createReportDownloadApp({
  pool,
  auth: configuredPrivyAuth(),
  mode: "researcher",
  store: reports,
  resolveKey: async (id) => {
    if (id !== keccak256(toHex(researcherKeys.publicKey)))
      throw new Error("The researcher key version is not available.");
    return researcherKeys;
  },
});
const host = process.env.APP_ENV === "local" ? "127.0.0.1" : "0.0.0.0";
await internal.listen({ host, port: Number(process.env.VERIFIER_INTERNAL_PORT ?? 4191) });
await downloads.listen({ host, port: Number(process.env.RESEARCHER_REPORT_PORT ?? 4192) });
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, async () => {
    await Promise.all([internal.close(), downloads.close()]);
    await pool.end();
  });
console.log("The fixture verifier and private researcher report endpoint are ready.");
