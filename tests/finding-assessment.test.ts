import { expect, it } from "vitest";
import {
  type BountyPolicy,
  GENERAL_FINDING_ADAPTER_ID,
  hashPolicy,
} from "../packages/domain/src/index.ts";
import { assessFinding, type FindingAssessors } from "../services/verifier/src/finding.ts";
import { a, h } from "./helpers/policy.ts";

function findingPolicy(): BountyPolicy {
  return {
    settlementChainId: "31337",
    escrow: a(1),
    organizationId: h(1),
    refundRecipient: a(2),
    sourceChainId: "31337",
    sourceVault: a(9),
    sourceBlockHash: h(2),
    fixtureManifestRoot: h(3),
    adapterId: GENERAL_FINDING_ADAPTER_ID,
    adapterCodeHash: h(5),
    verifierConfigHash: h(6),
    admissionSigner: a(4),
    verdictSigner: a(5),
    reportRecipientKeyId: h(7),
    asset: a(6),
    reward: "2000000",
    minimumDiscrepancy: "1",
    submissionDeadline: "1800086400",
    settlementDeadline: "1800088200",
    reservationDurationSeconds: "1800",
    organizationNonce: h(1),
  };
}
const evidence = {
  schemaVersion: "1" as const,
  pocLanguage: "solidity-foundry" as const,
  pocCode: "// test poc",
  writeup: "Reentrancy in withdraw() drains the vault.",
};
const tier = { minReward: 200000n, maxReward: 2000000n };
const assessorsFor = (overrides: Partial<FindingAssessors>): FindingAssessors => ({
  runSandbox:
    overrides.runSandbox ??
    (async () => ({
      ran: false,
      passed: false,
      touchedScope: false,
      simulated: false,
      logs: "",
      measuredImpact: null,
    })),
  judgeAi:
    overrides.judgeAi ??
    (async () => ({ valid: false, severity: "LOW", reasoning: "unused", confidence: 0 })),
});

it("caps a sandbox-measured reward at the tier max and stays valid", async () => {
  const policy = findingPolicy();
  const bountyId = hashPolicy(policy);
  const result = await assessFinding(
    evidence,
    policy,
    { claimId: h(42), bountyId, assessedAt: 1800000000n },
    tier,
    "0xVault",
    assessorsFor({
      runSandbox: async () => ({
        ran: true,
        passed: true,
        touchedScope: true,
        simulated: false,
        logs: "ok",
        measuredImpact: 9_000_000n,
      }),
    }),
  );
  expect(result.valid).toBe(true);
  expect(result.reward).toBe(tier.maxReward);
});

it("floors a sandbox-measured reward below the tier min at the tier min", async () => {
  const policy = findingPolicy();
  const bountyId = hashPolicy(policy);
  const result = await assessFinding(
    evidence,
    policy,
    { claimId: h(43), bountyId, assessedAt: 1800000000n },
    tier,
    "0xVault",
    assessorsFor({
      runSandbox: async () => ({
        ran: true,
        passed: true,
        touchedScope: true,
        simulated: false,
        logs: "ok",
        measuredImpact: 1000n,
      }),
    }),
  );
  expect(result.valid).toBe(true);
  expect(result.reward).toBe(tier.minReward);
});

it("passes through a measured impact inside the tier range unchanged", async () => {
  const policy = findingPolicy();
  const bountyId = hashPolicy(policy);
  const result = await assessFinding(
    evidence,
    policy,
    { claimId: h(44), bountyId, assessedAt: 1800000000n },
    tier,
    "0xVault",
    assessorsFor({
      runSandbox: async () => ({
        ran: true,
        passed: true,
        touchedScope: true,
        simulated: false,
        logs: "ok",
        measuredImpact: 900000n,
      }),
    }),
  );
  expect(result.valid).toBe(true);
  expect(result.reward).toBe(900000n);
});

it("falls back to the AI severity fraction when the sandbox is inconclusive", async () => {
  const policy = findingPolicy();
  const bountyId = hashPolicy(policy);
  const result = await assessFinding(
    evidence,
    policy,
    { claimId: h(45), bountyId, assessedAt: 1800000000n },
    tier,
    "0xVault",
    assessorsFor({
      runSandbox: async () => ({
        ran: false,
        passed: false,
        touchedScope: false,
        simulated: false,
        logs: "",
        measuredImpact: null,
      }),
      judgeAi: async () => ({
        valid: true,
        severity: "HIGH",
        reasoning: "Looks like a real access-control bypass.",
        confidence: 1,
      }),
    }),
  );
  expect(result.valid).toBe(true);
  const span = tier.maxReward - tier.minReward;
  expect(result.reward).toBe(tier.minReward + (span * 600n) / 1000n);
  expect(result.reward).toBeLessThanOrEqual(tier.maxReward);
  expect(result.reward).toBeGreaterThanOrEqual(tier.minReward);
});

it("rejects with zero reward when the AI judge finds it invalid and the sandbox did not run", async () => {
  const policy = findingPolicy();
  const bountyId = hashPolicy(policy);
  const result = await assessFinding(
    evidence,
    policy,
    { claimId: h(46), bountyId, assessedAt: 1800000000n },
    tier,
    "0xVault",
    assessorsFor({}),
  );
  expect(result.valid).toBe(false);
  expect(result.reward).toBe(0n);
  expect(result.report.outcome).toBe("DOES_NOT_QUALIFY");
});

it("rejects a passing PoC that never touched the in-scope contract, even if the AI judge says valid", async () => {
  const policy = findingPolicy();
  const bountyId = hashPolicy(policy);
  const result = await assessFinding(
    evidence,
    policy,
    { claimId: h(48), bountyId, assessedAt: 1800000000n },
    tier,
    "0xVault",
    assessorsFor({
      runSandbox: async () => ({
        ran: true,
        passed: true,
        touchedScope: false,
        simulated: false,
        logs: "ok",
        measuredImpact: 9_000_000n,
      }),
      judgeAi: async () => ({
        valid: true,
        severity: "CRITICAL",
        reasoning: "Looks convincing.",
        confidence: 1,
      }),
    }),
  );
  expect(result.valid).toBe(false);
  expect(result.reward).toBe(0n);
  expect(result.report.outcome).toBe("DOES_NOT_QUALIFY");
});

it("rejects a policy whose commitment hash does not match the claimed bounty", async () => {
  const policy = findingPolicy();
  await expect(
    assessFinding(
      evidence,
      policy,
      { claimId: h(47), bountyId: h(999), assessedAt: 1800000000n },
      tier,
      "0xVault",
      assessorsFor({}),
    ),
  ).rejects.toThrow("Policy commitment mismatch.");
});
