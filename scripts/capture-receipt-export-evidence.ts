import "dotenv/config";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { z } from "zod";
import { ReadOnlyBountyChain } from "../packages/chain/src/bounty-reader.ts";
import { hashCanonical } from "../packages/crypto-envelope/src/index.ts";
import { connectDatabase } from "../packages/database/src/index.ts";
import { address } from "../packages/domain/src/index.ts";
import {
  contentHash,
  exportSnapshotSchema,
  receiptCsv,
  verifyExportRecord,
} from "../services/receipts/src/records.ts";

const path = z.string().min(1).parse(process.argv[2]);
const exportId = z.uuid().parse(
  basename(path)
    .replace(/^vulnproof-receipts-/, "")
    .replace(/\.csv$/, ""),
);
const { pool } = connectDatabase();
try {
  const row = (await pool.query("select * from receipt_exports where id=$1", [exportId])).rows[0];
  assert.equal(row?.state, "READY");
  const snapshot = exportSnapshotSchema.parse(row.snapshot_json);
  assert.equal(hashCanonical(snapshot), row.input_hash);
  assert.equal(snapshot.organizationId, row.organization_id);
  assert.equal(snapshot.requestedBy, row.requested_by);
  const downloaded = await readFile(path, "utf8");
  assert.equal(downloaded, row.csv);
  assert.equal(downloaded, receiptCsv(snapshot.records));
  assert.equal(contentHash(downloaded), row.content_hash);
  const chain = new ReadOnlyBountyChain(
    "https://rpc.testnet.arc.io",
    5042002,
    address.parse(process.env.ESCROW_ADDRESS),
  );
  for (const record of snapshot.records) {
    const receipt = await chain.finalReceipt(record.transactionHash);
    assert(receipt, "An exported transaction is not canonical and final.");
    verifyExportRecord(record, receipt);
  }
  const jobs = (
    await pool.query(
      "select id,state,completed_on from pgboss.job where name='receipt-export' and data->>'exportId'=$1 and state='completed' order by completed_on desc limit 1",
      [exportId],
    )
  ).rows;
  assert.equal(jobs.length, 1, "No completed receipt export job exists.");
  const evidence = {
    schemaVersion: "1",
    scope: "LIVE_ORGANIZATION_RECEIPT_EXPORT",
    capturedAt: new Date().toISOString(),
    baseCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    exportId,
    chainId: "5042002",
    evidenceScope: "FIXTURE_ONLY",
    verifierMode: "TRUSTED_SERVICE",
    contentHash: row.content_hash,
    downloadedBytesMatchSavedExport: true,
    exactCsvFromImmutableSnapshot: true,
    records: snapshot.records.map((record) => ({
      category: record.category,
      amountBaseUnits: record.amount,
      asset: record.asset,
      transactionHash: record.transactionHash,
      blockNumber: record.blockNumber,
      blockHash: record.blockHash,
      logIndex: record.logIndex,
      eventName: record.eventName,
      canonicalFinalizedEvent: true,
    })),
    queue: { jobId: jobs[0].id, state: jobs[0].state, completedAt: jobs[0].completed_on },
    limits: [
      "This capture verifies one organization export through the local app and live Arc Testnet.",
      "It does not prove hosted operation, separate live user access, or researcher receipt export.",
    ],
  };
  await writeFile(
    `evidence/arc/receipt-export-${exportId}.json`,
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  process.stdout.write(
    `Verified ${snapshot.records.length} downloaded receipt rows against final Arc events.\n`,
  );
} finally {
  await pool.end();
}
