import "dotenv/config";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { type Hex, parseEventLogs } from "viem";
import { bountyEscrowAbi } from "../packages/chain/src/abi/BountyEscrow.ts";
import { ReadOnlyBountyChain } from "../packages/chain/src/bounty-reader.ts";
import { hasExactTransfer } from "../packages/chain/src/transfers.ts";
import { connectDatabase } from "../packages/database/src/index.ts";
import { bytes32, policySchema } from "../packages/domain/src/index.ts";
import { verifyManifest } from "../packages/fixture-manifest/src/index.ts";
import { verifyReportBytes } from "../packages/report-integrity/src/index.ts";

const [bundlePath, ...reportPaths] = process.argv.slice(2);
if (!bundlePath || reportPaths.length !== 3)
  throw new Error("Provide the signed case bundle and three downloaded case reports.");
const { pool } = connectDatabase();
try {
  const bundle = JSON.parse(await readFile(bundlePath, "utf8"));
  const manifestRow = (
    await pool.query("select owner_signature,status from fixture_manifests where root=$1", [
      bytes32.parse(bundle.manifest.root),
    ])
  ).rows[0];
  assert.equal(manifestRow?.status, "SIGNED");
  const { manifest } = await verifyManifest(bundle.manifest, manifestRow.owner_signature);
  const results = [];
  let commonBounty: string | undefined;
  for (const path of reportPaths) {
    const bytes = await readFile(path);
    const report = JSON.parse(bytes.toString());
    const claimId = bytes32.parse(report.claimId);
    const row = (
      await pool.query(
        `select c.claim_id,c.claimant_address,c.evidence_commitment,c.job_state,r.id as report_id,r.report_hash,
        r.state as report_state,r.paid_event_ref,a.outcome,b.bounty_id,b.policy_json
        from claims c join reports r on r.claim_id=c.claim_id
        join assessments a on a.claim_id=c.claim_id join bounties b on b.bounty_id=c.bounty_id
        where c.claim_id=$1`,
        [claimId],
      )
    ).rows[0];
    assert(row, "The report has no matching saved claim.");
    verifyReportBytes(bytes, row.report_hash);
    assert.equal(report.evidenceScope, "FIXTURE_ONLY");
    assert.equal(report.verifierMode, "TRUSTED_SERVICE");
    assert.equal(report.outcome, row.outcome);
    assert.equal(report.bountyId, row.bounty_id);
    assert.equal(row.job_state, "SETTLED");
    commonBounty ??= row.bounty_id;
    assert.equal(row.bounty_id, commonBounty);
    const policy = policySchema.parse(row.policy_json);
    assert.equal(policy.fixtureManifestRoot, manifest.root);
    assert.equal(policy.settlementChainId, "5042002");
    assert.equal(policy.organizationId, manifest.organizationId);
    const fixtureCase = manifest.cases.find((item) => item.leafHash === report.fixtureLeafHash);
    assert(fixtureCase, "The report case is absent from the signed manifest.");
    const chain = new ReadOnlyBountyChain("https://rpc.testnet.arc.io", 5042002, policy.escrow);
    const snapshot = await chain.read(policy);
    assert.equal(snapshot.state, 4, "The bounty does not have a final paid state.");
    const savedEvents = (
      await pool.query(
        "select * from chain_events where chain_id='5042002' and contract_address=$1 and payload_json->>'claimId'=$2 order by block_number,log_index",
        [policy.escrow, claimId],
      )
    ).rows;
    const events = [];
    for (const saved of savedEvents) {
      const receipt = await chain.finalReceipt(saved.transaction_hash as Hex);
      assert(receipt?.status === "success", "The event has no final successful receipt.");
      assert.equal(receipt.blockHash, saved.block_hash);
      assert.equal(receipt.blockNumber.toString(), saved.block_number);
      const event = parseEventLogs({
        abi: bountyEscrowAbi,
        logs: receipt.logs.filter((log) => log.address.toLowerCase() === policy.escrow),
        strict: true,
      }).find((log) => log.logIndex === saved.log_index && log.eventName === saved.name);
      assert(event, "The saved event does not match the canonical log.");
      const payload = Object.fromEntries(
        Object.entries(event.args).map(([key, value]) => [
          key,
          typeof value === "bigint"
            ? String(value)
            : typeof value === "string"
              ? value.toLowerCase()
              : value,
        ]),
      );
      assert.deepEqual(payload, saved.payload_json);
      assert.equal(payload.claimId, claimId);
      assert.equal(payload.bountyId, row.bounty_id);
      if (event.eventName === "ClaimReserved") {
        assert.equal(payload.claimant, row.claimant_address);
        assert.equal(payload.evidenceCommitment, row.evidence_commitment);
      }
      if (event.eventName === "ClaimQualified") {
        assert.equal(payload.claimant, row.claimant_address);
        assert.equal(payload.reward, policy.reward);
        assert.equal(payload.reportHash, row.report_hash);
      }
      if (event.eventName === "Paid") {
        assert.equal(payload.claimant, row.claimant_address);
        assert.equal(payload.amount, policy.reward);
        assert.equal(payload.asset, policy.asset);
        assert(
          hasExactTransfer(receipt.logs, {
            from: policy.escrow,
            recipient: row.claimant_address,
            amount: policy.reward,
          }),
        );
        assert.equal(row.paid_event_ref, saved.id);
      }
      events.push({
        name: event.eventName,
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber.toString(),
        blockHash: receipt.blockHash,
        logIndex: event.logIndex,
        canonicalFinalizedReceipt: true,
      });
    }
    const qualifies = fixtureCase.label === "QUALIFYING";
    assert.deepEqual(
      events.map((event) => event.name),
      qualifies ? ["ClaimReserved", "ClaimQualified", "Paid"] : ["ClaimReserved", "ClaimRejected"],
    );
    assert.equal(row.outcome, qualifies ? "QUALIFIES" : "DOES_NOT_QUALIFY");
    assert.equal(row.report_state, qualifies ? "AVAILABLE" : "SEALED");
    if (!qualifies) assert.equal(row.paid_event_ref, null);
    results.push({
      label: fixtureCase.label,
      claimId,
      caseId: report.caseId,
      discrepancy: report.discrepancy,
      outcome: row.outcome,
      reportId: row.report_id,
      reportHash: row.report_hash,
      downloadedReportHashVerified: true,
      organizationReportState: row.report_state,
      rewardBaseUnits: qualifies ? policy.reward : "0",
      events,
    });
  }
  assert.equal(new Set(results.map((result) => result.label)).size, 3);
  await mkdir("evidence/arc", { recursive: true });
  await writeFile(
    `evidence/arc/claim-journey-${commonBounty}.json`,
    `${JSON.stringify(
      {
        schemaVersion: "1",
        scope: "LIVE_ARC_THREE_CASE_JOURNEY",
        capturedAt: new Date().toISOString(),
        baseCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
        chainId: "5042002",
        bountyId: commonBounty,
        signedManifestRoot: manifest.root,
        results,
        limits: [
          "The live owner and claimant use the same Privy account. Separate live actor isolation is not proven.",
          "This evidence proves synthetic fixture settlement. It does not prove a real vault vulnerability or hosted service isolation.",
        ],
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(
    "Verified three live case results, final chain events, payment, and downloaded report hashes.\n",
  );
} finally {
  await pool.end();
}
