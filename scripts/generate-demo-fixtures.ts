import { randomBytes } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import type { Hex } from "viem";
import { createManifestCases } from "../packages/fixture-manifest/src/index.ts";

try {
  await access("demo/fixtures/catalog.json");
  process.stdout.write("The demo fixture catalog already exists.\n");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  const random = () => `0x${randomBytes(32).toString("hex")}` as Hex;
  const catalog = createManifestCases(
    [random(), random(), random()],
    [random(), random(), random()],
  );
  await mkdir("demo/fixtures", { recursive: true });
  for (const item of catalog.fixtures)
    await writeFile(
      `demo/fixtures/${item.label.toLowerCase()}.json`,
      `${JSON.stringify(item.fixture, null, 2)}\n`,
      { flag: "wx" },
    );
  await writeFile(
    "demo/fixtures/catalog.json",
    `${JSON.stringify({ schemaVersion: "1", synthetic: true, root: catalog.root, cases: catalog.cases, minimumDiscrepancy: "1000000" }, null, 2)}\n`,
    { flag: "wx" },
  );
  process.stdout.write("Three public synthetic fixtures and their commitments are ready.\n");
}
