import "dotenv/config";
import { readFile } from "node:fs/promises";
import { keccak256, toHex } from "viem";
import { z } from "zod";
import { ReadOnlyBountyChain } from "../../../packages/chain/src/bounty-reader.ts";
import { FileCiphertextStore } from "../../../packages/ciphertext-store/src/index.ts";
import { hashCanonical } from "../../../packages/crypto-envelope/src/index.ts";
import { connectDatabase } from "../../../packages/database/src/index.ts";
import { address, bytes32 } from "../../../packages/domain/src/index.ts";
import { loadPublicConfig, loadTestnetSecret } from "../../../packages/service-config/src/index.ts";
import { createVerifierApp } from "./app.ts";
import { FindingVerifier } from "./finding-process.ts";

const config = await loadPublicConfig(
  process.env.FINDING_SERVICE_PUBLIC_CONFIG ?? ".local/config/finding-public-services.json",
);
const paths = [
  "services/verifier/src/finding.ts",
  "services/verifier/src/finding-process.ts",
  "packages/domain/src/index.ts",
  "packages/crypto-envelope/src/index.ts",
];
const sources = Object.fromEntries(
  await Promise.all(
    paths.map(async (path) => [path, keccak256(toHex(await readFile(path, "utf8")))]),
  ),
);
if (
  hashCanonical({ sources, dependencies: { viem: "2.56.3", zod: "4.5.4" } }) !==
  config.adapterCodeHash
)
  throw new Error("The running finding adapter differs from its published code commitment.");
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
const { pool } = connectDatabase();
const verifier = new FindingVerifier(pool, {
  config,
  evidence: new FileCiphertextStore(
    process.env.EVIDENCE_DIRECTORY ?? ".local/ciphertext/evidence",
    262192,
  ),
  reports: new FileCiphertextStore(
    process.env.REPORT_DIRECTORY ?? ".local/ciphertext/reports",
    1048576,
  ),
  reader: new ReadOnlyBountyChain(
    "https://rpc.testnet.arc.io",
    5042002,
    address.parse(process.env.ESCROW_ADDRESS),
  ),
  evidenceKeys,
  researcherKeys,
  admissionKey: await signer(
    ".local/keys/admission-signing-finding.json",
    "FINDING_ADMISSION_SIGNING",
  ),
  verdictKey: await signer(".local/keys/verdict-signing-finding.json", "FINDING_VERDICT_SIGNING"),
});
const internal = createVerifierApp(verifier, config.serviceIdentities.worker, "finding-verifier");
const host = process.env.APP_ENV === "local" ? "127.0.0.1" : "0.0.0.0";
await internal.listen({ host, port: Number(process.env.FINDING_VERIFIER_INTERNAL_PORT ?? 4196) });
process.once("SIGTERM", async () => {
  await internal.close();
  await pool.end();
});
process.once("SIGINT", async () => {
  await internal.close();
  await pool.end();
});
console.log("The findings verifier is ready.");
