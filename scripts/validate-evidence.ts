import { access, readFile } from "node:fs/promises";
import { z } from "zod";
import { evidenceFiles, liveManifestSchema, readArtifact } from "./release-evidence.ts";

try {
  const manifest = liveManifestSchema.parse(
    (await readArtifact("evidence/live-manifest.json")).data,
  );
  for (const [name, expectedPath] of Object.entries(evidenceFiles)) {
    const entry = manifest.artifacts[name as keyof typeof evidenceFiles];
    if (entry.path !== expectedPath)
      throw new Error("An indexed evidence path differs from the expected capture.");
    const actual = await readArtifact(entry.path);
    if (actual.reference.sha256 !== entry.sha256)
      throw new Error("An indexed evidence file has changed. Rebuild and review the index.");
  }
  process.stdout.write(
    `Verified ${Object.keys(manifest.artifacts).length} evidence file hashes and credential-field checks.\n`,
  );
  if (!process.argv.includes("--files-only")) {
    const blocked = [...manifest.remainingRequirements];
    for (const path of ["evidence/test-summary.json", "evidence/live-read-checks.json"])
      await access(path).catch(() => blocked.push(`Missing ${path}.`));
    try {
      const live = z
        .object({
          scope: z.literal("LIVE_READ_ONLY_RECHECK"),
          transactionsSent: z.literal(false),
          result: z.literal("PASS"),
          manifest: z.object({
            path: z.literal("evidence/live-manifest.json"),
            sha256: z.string(),
          }),
          results: z.array(z.object({ id: z.string(), result: z.literal("PASS") })).min(3),
        })
        .parse((await readArtifact("evidence/live-read-checks.json")).data);
      const receiptCount = z
        .object({ records: z.array(z.unknown()) })
        .parse((await readArtifact(evidenceFiles.organizationExport)).data).records.length;
      const claimCount = z
        .object({ results: z.array(z.object({ events: z.array(z.unknown()) })) })
        .parse((await readArtifact(evidenceFiles.claims)).data)
        .results.reduce((sum, claim) => sum + claim.events.length, 0);
      const requiredIds = [
        "ARC_DEPLOYMENT",
        "GRA-01",
        ...Array.from(
          { length: receiptCount + claimCount + 1 },
          (_, index) => `ARC_EVENT_${index + 1}`,
        ),
      ];
      if (
        live.manifest.sha256 !==
          (await readArtifact("evidence/live-manifest.json")).reference.sha256 ||
        new Set(live.results.map((row) => row.id)).size !== live.results.length ||
        live.results.length !== requiredIds.length ||
        !requiredIds.every((id) => live.results.some((row) => row.id === id))
      )
        throw new Error("The live check does not match the current evidence index.");
    } catch {
      blocked.push(
        "The live read check is missing, failed, or refers to a different evidence index.",
      );
    }
    const pkg = JSON.parse(await readFile("package.json", "utf8"));
    for (const command of ["test:e2e", "test:live", "seed:local", "evidence:validate"])
      if (!pkg.scripts[command]) blocked.push(`Missing root command: ${command}.`);
    process.stdout.write(`Submission readiness: BLOCKED (${blocked.length} open checks).\n`);
    for (const reason of blocked) process.stdout.write(`- ${reason}\n`);
    process.exitCode = 2;
  }
} catch {
  process.stderr.write(
    "Evidence validation failed. Check the manifest, expected files, hashes, and credential fields. Raw artifact contents are omitted.\n",
  );
  process.exitCode = 1;
}
