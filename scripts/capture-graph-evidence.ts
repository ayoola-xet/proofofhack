import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";
import sources from "../packages/erc4626-coverage-data/sources.json";
import {
  COVERAGE_QUERY,
  GraphCoverageClient,
} from "../packages/erc4626-coverage-data/src/client.ts";

const endpoint = z.string().url().parse(process.env.GRAPH_ENDPOINT);
const client = new GraphCoverageClient(
  endpoint,
  process.env.GRAPH_DEPLOYMENT_ID ?? null,
  process.env.GRAPH_API_KEY || undefined,
);
const rows = await client.query(sources.map((s) => `${s.chainId}:${s.address}`));
if (
  rows.length !== sources.length ||
  rows.some((r) => r.readStatus !== "OK" || r.hasIndexingErrors)
)
  throw new Error("The live Graph source gate failed.");
const now = Date.now();
if (
  rows.some(
    (r) =>
      !r.observedAt ||
      now - Date.parse(r.observedAt) > 300000 ||
      !r.indexedHeadAt ||
      now - Date.parse(r.indexedHeadAt) > 300000,
  )
)
  throw new Error("The live Graph freshness gate failed.");
await mkdir("evidence/the-graph", { recursive: true });
await writeFile(
  "evidence/the-graph/live-query.json",
  `${JSON.stringify(
    {
      capturedAt: new Date().toISOString(),
      environment: "LIVE_PUBLIC_DATA",
      endpoint,
      query: COVERAGE_QUERY,
      rows,
    },
    null,
    2,
  )}\n`,
);
process.stdout.write(`Captured ${rows.length} fresh live vault observations.\n`);
