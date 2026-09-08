import "dotenv/config";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { keccak256 } from "viem";
import { z } from "zod";
import { ARC_USDC, arcClient } from "../packages/chain/src/arc.ts";
import { ReadOnlyBountyChain } from "../packages/chain/src/bounty-reader.ts";
import { address, bytes32, uint } from "../packages/domain/src/index.ts";
import sources from "../packages/erc4626-coverage-data/sources.json";
import { GraphCoverageClient } from "../packages/erc4626-coverage-data/src/client.ts";
import { type ExpectedEvent, expectedEventSchema, verifyLiveEvent } from "./live-event-check.ts";
import { liveManifestSchema, readArtifact } from "./release-evidence.ts";

if (
  process.env.LIVE_READ_ONLY !== "arc-testnet" ||
  process.env.ARC_CHAIN_ID !== "5042002" ||
  process.env.ARC_USDC_ADDRESS !== ARC_USDC
)
  throw new Error(
    "Set LIVE_READ_ONLY=arc-testnet, ARC_CHAIN_ID=5042002, and the Arc Testnet USDC address. This command sends no transactions.",
  );
const manifest = liveManifestSchema.parse((await readArtifact("evidence/live-manifest.json")).data);
async function source(name: keyof typeof manifest.artifacts) {
  const entry = manifest.artifacts[name],
    result = await readArtifact(entry.path);
  assert.equal(
    result.reference.sha256,
    entry.sha256,
    "An indexed evidence file changed. Rebuild and review the evidence index.",
  );
  return result.data;
}
const escrow = z
  .object({
    contract: address,
    transactionHash: bytes32,
    blockNumber: uint(),
    blockHash: bytes32,
    runtimeCodeHash: bytes32,
  })
  .parse(await source("escrow"));
const controller = z.object({ address }).parse(await source("controller"));
const graph = z
  .object({ endpoint: z.url(), rows: z.array(z.object({ deploymentId: z.string() })).min(3) })
  .parse(await source("graph"));
const endpoint = z.url().parse(process.env.GRAPH_ENDPOINT),
  deployment = z.string().min(1).parse(process.env.GRAPH_DEPLOYMENT_ID);
assert.equal(
  endpoint,
  graph.endpoint,
  "The configured Graph endpoint differs from the indexed endpoint.",
);
assert(graph.rows.every((row) => row.deploymentId === deployment));
const graphUrl = new URL(endpoint);
assert(
  graphUrl.protocol === "https:" && !graphUrl.username && !graphUrl.password && !graphUrl.search,
);
const client = arcClient(),
  chain = new ReadOnlyBountyChain("https://rpc.testnet.arc.io", 5042002, escrow.contract);
const results: { id: string; result: "PASS" | "FAIL"; detail: unknown }[] = [];
async function check(id: string, action: () => Promise<unknown>) {
  try {
    results.push({ id, result: "PASS", detail: await action() });
  } catch {
    results.push({
      id,
      result: "FAIL",
      detail: "The read-only check did not pass. Provider response text is omitted.",
    });
  }
  process.stdout.write(`${id}: ${results.at(-1)?.result}\n`);
}
await check("ARC_DEPLOYMENT", async () => {
  assert.equal(await client.getChainId(), 5042002);
  const receipt = await chain.finalReceipt(escrow.transactionHash);
  assert(receipt && receipt.status === "success");
  assert.equal(receipt.blockHash, escrow.blockHash);
  assert.equal(String(receipt.blockNumber), escrow.blockNumber);
  for (const block of [BigInt(escrow.blockNumber), undefined]) {
    const code = await client.getCode({
      address: escrow.contract,
      ...(block === undefined ? { blockTag: "finalized" as const } : { blockNumber: block }),
    });
    assert(code && code !== "0x");
    assert.equal(keccak256(code), escrow.runtimeCodeHash);
  }
  return {
    address: escrow.contract,
    transactionHash: escrow.transactionHash,
    runtimeCodeHash: escrow.runtimeCodeHash,
  };
});
await check("GRA-01", async () => {
  const ids = sources.map((row) => `${row.chainId}:${row.address}`);
  const rows = await new GraphCoverageClient(
    endpoint,
    deployment,
    process.env.GRAPH_QUERY_KEY,
  ).query(ids);
  assert.deepEqual(rows.map((r) => r.vaultId).sort(), [...ids].sort());
  const now = Date.now();
  for (const row of rows) {
    assert(
      row.readStatus === "OK" &&
        !row.hasIndexingErrors &&
        row.totalAssets !== null &&
        row.totalSupply !== null,
    );
    for (const value of [row.observedAt, row.indexedHeadAt]) {
      assert(value);
      const age = now - Date.parse(value);
      assert(age >= -30000 && age <= 300000);
    }
  }
  return { endpoint, deployment, rows };
});
const record = z.object({
  category: z.string(),
  amountBaseUnits: uint(),
  asset: z.literal(ARC_USDC),
  transactionHash: bytes32,
  blockNumber: uint(),
  blockHash: bytes32,
  logIndex: uint(),
  eventName: z.string(),
});
const receipts = z
  .object({ records: z.array(record).min(1) })
  .parse(await source("organizationExport"));
const events: ExpectedEvent[] = receipts.records.map((row) =>
  expectedEventSchema.parse({
    name: row.eventName,
    contract:
      row.category === "BUDGET_DEPOSIT"
        ? ARC_USDC
        : row.category.startsWith("BUDGET_")
          ? controller.address
          : escrow.contract,
    transactionHash: row.transactionHash,
    blockNumber: row.blockNumber,
    blockHash: row.blockHash,
    logIndex: Number(row.logIndex),
    fields: {
      [row.category === "FUNDING"
        ? "reward"
        : row.category === "BUDGET_DEPOSIT"
          ? "value"
          : "amount"]: row.amountBaseUnits,
      ...(["FUNDING", "PAYMENT"].includes(row.category) ? { asset: ARC_USDC } : {}),
    },
  }),
);
const claims = z
  .object({
    bountyId: bytes32,
    results: z
      .array(
        z.object({
          claimId: bytes32,
          reportHash: bytes32,
          events: z.array(
            z.object({
              name: z.string(),
              transactionHash: bytes32,
              blockNumber: uint(),
              blockHash: bytes32,
              logIndex: z.number().int().nonnegative(),
            }),
          ),
        }),
      )
      .length(3),
  })
  .parse(await source("claims"));
for (const claim of claims.results)
  for (const event of claim.events)
    events.push(
      expectedEventSchema.parse({
        ...event,
        contract: escrow.contract,
        fields: {
          claimId: claim.claimId,
          bountyId: claims.bountyId,
          ...(event.name === "ClaimQualified" ? { reportHash: claim.reportHash } : {}),
        },
      }),
    );
const outgoing = z
  .object({
    from: address,
    recipient: address,
    amountBaseUnits: uint(),
    transactionHash: bytes32,
    blockNumber: uint(),
    blockHash: bytes32,
    afterReward: z.object({ paymentTransactionHash: bytes32, paymentBlockNumber: uint() }),
  })
  .parse(await source("outgoing"));
assert(BigInt(outgoing.blockNumber) > BigInt(outgoing.afterReward.paymentBlockNumber));
const paid = events.find(
  (event) =>
    event.name === "Paid" && event.transactionHash === outgoing.afterReward.paymentTransactionHash,
);
assert(paid, "The outgoing transfer has no matching saved payment event.");
assert.equal(paid.blockNumber, outgoing.afterReward.paymentBlockNumber);
paid.fields.claimant = outgoing.from;
events.push(
  expectedEventSchema.parse({
    name: "Transfer",
    contract: ARC_USDC,
    transactionHash: outgoing.transactionHash,
    blockNumber: outgoing.blockNumber,
    blockHash: outgoing.blockHash,
    fields: { from: outgoing.from, to: outgoing.recipient, value: outgoing.amountBaseUnits },
  }),
);
const seen = new Map<string, ReturnType<typeof chain.finalReceipt>>();
for (const [index, event] of events.entries())
  await check(`ARC_EVENT_${index + 1}`, async () => {
    let pending = seen.get(event.transactionHash);
    if (!pending) {
      pending = chain.finalReceipt(event.transactionHash);
      seen.set(event.transactionHash, pending);
    }
    const receipt = await pending;
    assert(receipt);
    verifyLiveEvent(event, receipt);
    return event;
  });
const output = {
  schemaVersion: "1",
  scope: "LIVE_READ_ONLY_RECHECK",
  capturedAt: new Date().toISOString(),
  sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  manifest: (await readArtifact("evidence/live-manifest.json")).reference,
  chainId: "5042002",
  transactionsSent: false,
  result: results.every((r) => r.result === "PASS") ? "PASS" : "FAIL",
  results,
  limits: [
    "This command rechecks public data and recorded event fields. It does not repeat browser or wallet authorization flows.",
    "It does not recheck confidential report access, model output, provider policy rejection, or budget limit simulations.",
    "A passing read-only check is not submission readiness.",
  ],
};
await writeFile("evidence/live-read-checks.json", `${JSON.stringify(output, null, 2)}\n`);
if (output.result !== "PASS") process.exitCode = 1;
