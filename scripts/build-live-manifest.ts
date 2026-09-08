import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { evidenceFiles, liveManifestSchema, readArtifact } from "./release-evidence.ts";

const artifacts = Object.fromEntries(
  await Promise.all(
    Object.entries(evidenceFiles).map(async ([name, path]) => [
      name,
      (await readArtifact(path)).reference,
    ]),
  ),
);
const manifest = liveManifestSchema.parse({
  schemaVersion: "1",
  scope: "TESTNET_SUBMISSION_EVIDENCE_INDEX",
  generatedAt: new Date().toISOString(),
  sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  sponsors: ["The Graph", "Arc", "Privy"],
  chainId: "5042002",
  asset: "0x3600000000000000000000000000000000000000",
  evidenceScope: "FIXTURE_ONLY",
  verifierMode: "TRUSTED_SERVICE",
  submissionReady: false,
  artifacts,
  remainingRequirements: [
    "Complete the requirement-by-requirement acceptance mapping and test summary.",
    "Implement the required test:e2e and seed:local commands.",
    "Generate the OpenAPI specification.",
    "Verify live model recommendations and changed-source behavior.",
    "Verify separate live organization and researcher accounts.",
    "Verify live reservation expiry.",
    "Deploy on the approved public host and verify backup, restore, and pending financial recovery.",
    "Run the staging performance and complete responsive accessibility checks.",
    "Verify source publication, CI execution, event eligibility, and named team contributions.",
    "Record the required demo video and complete the final submission assets.",
  ],
  limits: [
    "Artifact hashes detect changed files. They do not certify that an artifact's claims are true.",
    "Each source retains its own capture time and scope. Historical evidence is not a current provider check.",
    "The index does not establish sponsor eligibility or award stacking.",
  ],
});
await writeFile("evidence/live-manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(
  `Indexed ${Object.keys(artifacts).length} evidence files. The submission remains incomplete.\n`,
);
