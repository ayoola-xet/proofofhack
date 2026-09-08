import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { z } from "zod";

export const evidenceFiles = {
  graph: "evidence/the-graph/live-query.json",
  escrow: "evidence/arc/escrow-deployment.json",
  controller: "evidence/arc/controller-c9d8a04b-4f44-4336-846d-4d484e4dc8f4.json",
  funding: "evidence/arc/bounty-funding.json",
  claims:
    "evidence/arc/claim-journey-0xa3147639ed3a03f68dab3f18cbb81d249c23ff6efb452f25b56c12ae8ba34a68.json",
  budget: "evidence/arc/budget-allocation-9c60762d-cd1d-4fad-ace3-b45f971d9c6e.json",
  refund:
    "evidence/arc/recovery-0xa26a9f3f8c56461e41ed35f85af089ef63617692a1e284abe60ad1953c813b87.json",
  ownerActions: "evidence/privy/owner-actions-0e36ddc6-5cfa-46cf-8c2f-6e9ad0d5fdb8.json",
  outgoing: "evidence/privy/outgoing-transfer-bd232fd2-fd37-442e-9a22-969d8fa7e35c.json",
  policyDenied:
    "evidence/privy/treasury-funding-over-cap-92a15f31-8003-4cfd-a30a-103eb855fe6d.json",
  organizationExport: "evidence/arc/receipt-export-7e79696a-9135-41a3-818c-e73f0540f4ab.json",
  researcherExport: "evidence/arc/receipt-export-427fa358-8cab-424f-9ffb-b94c06d54c0c.json",
  containers: "evidence/local/container-check.json",
  browserDesktop: "evidence/local/browser-e2e-desktop.json",
  browserMobile: "evidence/local/browser-e2e-mobile-reduced-motion.json",
} as const;
export const sha256 = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
export const artifactSchema = z.strictObject({
  path: z.string().regex(/^evidence\/[a-zA-Z0-9/_.-]+\.json$/),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export async function readArtifact(path: string, root = process.cwd()) {
  artifactSchema.shape.path.parse(path);
  const actual = await realpath(resolve(root, path));
  if (!actual.startsWith(`${await realpath(resolve(root, "evidence"))}${sep}`))
    throw new Error("Evidence paths must stay inside the evidence directory.");
  const bytes = await readFile(actual);
  const data: unknown = JSON.parse(bytes.toString("utf8"));
  rejectSecrets(data);
  return { data, reference: { path, sha256: sha256(bytes) } };
}
export function rejectSecrets(value: unknown): void {
  if (
    typeof value === "string" &&
    (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(value) ||
      /Bearer\s+[a-zA-Z0-9._-]{16,}/.test(value))
  )
    throw new Error("Evidence contains credential-like text.");
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (
      /^(private_?key|api_?key|access_?token|refresh_?token|client_?secret|app_?secret|password|mnemonic|seed_?phrase)$/i.test(
        key,
      )
    )
      throw new Error("Evidence contains a credential field.");
    rejectSecrets(item);
  }
}
export const liveManifestSchema = z.strictObject({
  schemaVersion: z.literal("1"),
  scope: z.literal("TESTNET_SUBMISSION_EVIDENCE_INDEX"),
  generatedAt: z.iso.datetime(),
  sourceCommit: z.string().regex(/^[0-9a-f]{40}$/),
  sponsors: z.tuple([z.literal("The Graph"), z.literal("Arc"), z.literal("Privy")]),
  chainId: z.literal("5042002"),
  asset: z.literal("0x3600000000000000000000000000000000000000"),
  evidenceScope: z.literal("FIXTURE_ONLY"),
  verifierMode: z.literal("TRUSTED_SERVICE"),
  submissionReady: z.literal(false),
  artifacts: z.record(
    z.enum(
      Object.keys(evidenceFiles) as [keyof typeof evidenceFiles, ...(keyof typeof evidenceFiles)[]],
    ),
    artifactSchema,
  ),
  remainingRequirements: z.array(z.string().min(1)).min(1),
  limits: z.array(z.string().min(1)).min(1),
});
