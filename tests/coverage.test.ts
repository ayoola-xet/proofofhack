import { toHex } from "viem";
import { describe, expect, it } from "vitest";
import { hashPolicy } from "../packages/domain/src/index.ts";
import { normalizeGraph } from "../packages/erc4626-coverage-data/src/client.ts";
import {
  type CoverageTerms,
  evaluateCoverage,
  explainDeterministically,
} from "../services/coverage/src/engine.ts";
import { examplePolicy } from "./helpers/policy.ts";

const address = toHex(1, { size: 20 });
const asset = toHex(2, { size: 20 });
const hash = toHex(1, { size: 32 });
const now = new Date("2026-09-08T03:00:00Z");
const timestamp = String(Math.floor(now.getTime() / 1000) - 60);
const response = {
  vaults: [
    {
      id: `1:${address}`,
      chainId: "1",
      address,
      asset,
      assetDecimals: 18,
      shareDecimals: 18,
      implementationLabel: "Public fixture context",
      firstObservedBlock: "99",
      latestObservation: {
        id: `1:${address}:100`,
        blockNumber: "100",
        blockHash: hash,
        blockTimestamp: timestamp,
        totalAssets: "900719925474099312345",
        totalSupply: "6000000000000000000",
        readStatus: "OK",
        schemaVersion: "1",
      },
    },
  ],
  sourceCursors: [],
  _meta: {
    deployment: "QmExampleDeployment",
    hasIndexingErrors: false,
    block: { number: 105, hash, timestamp: Number(timestamp) },
  },
};
const observation = () => normalizeGraph(response, [`1:${address}`], now)[0];
const terms: CoverageTerms = {
  organizationId: hash,
  minReward: 25_000_000n,
  settlementAsset: asset,
  settlementChainId: "5042002",
  maxObservationAgeSeconds: 300,
  maxHeadAgeSeconds: 300,
  recommendationTtlSeconds: 300,
};
describe("Graph source and coverage rules", () => {
  it("Selects the exact approved policy and preserves its hash", () => {
    const policy = {
      ...examplePolicy(),
      sourceVault: address,
      asset,
      organizationId: hash,
      settlementChainId: "5042002",
    };
    const approved = {
      controllerId: "approved-controller",
      policy,
      policyHash: hashPolicy(policy),
      approvedUntil: Math.floor(now.getTime() / 1000) + 600,
      consumed: false,
      controllerEnabled: true,
    };
    const result = evaluateCoverage(observation(), terms, [], [approved], now);
    expect(result.status).toBe("ACTIONABLE");
    expect(result.proposedAction?.policyHash).toBe(approved.policyHash);
    expect(
      evaluateCoverage(observation(), terms, [], [{ ...approved, consumed: true }], now).status,
    ).toBe("ABSTAIN");
    expect(
      evaluateCoverage(observation(), terms, [], [{ ...approved, policyHash: hash }], now).status,
    ).toBe("ABSTAIN");
  });
  it("Preserves exact amounts and separates observation time from index progress", () => {
    const row = observation();
    expect(row.totalAssets).toBe("900719925474099312345");
    expect(row.observedBlock).toBe("100");
    expect(row.indexedHead).toBe("105");
  });
  it("Rejects an unexpected source or an observation beyond the indexed head", () => {
    expect(() => normalizeGraph(response, [])).toThrow();
    expect(() =>
      normalizeGraph(
        {
          ...response,
          _meta: { ...response._meta, block: { ...response._meta.block, number: 99 } },
        },
        [`1:${address}`],
      ),
    ).toThrow();
  });
  it("Abstains on old observations even when the indexed head is recent", () => {
    const row = {
      ...observation(),
      observedAt: new Date(now.getTime() - 600000).toISOString(),
      indexedHeadAt: now.toISOString(),
    };
    expect(evaluateCoverage(row, terms, [], [], now).reasonCode).toBe("STALE_OBSERVATION");
  });
  it("Abstains on incomplete metrics and indexing errors", () => {
    expect(
      evaluateCoverage({ ...observation(), totalAssets: null }, terms, [], [], now).status,
    ).toBe("ABSTAIN");
    expect(
      evaluateCoverage({ ...observation(), hasIndexingErrors: true }, terms, [], [], now)
        .reasonCode,
    ).toBe("INDEXING_ERROR");
  });
  it("Counts only active rewards in the same settlement units", () => {
    const bounty = {
      sourceChainId: "1",
      sourceVault: address,
      organizationId: hash,
      settlementChainId: "5042002",
      asset,
      state: "FUNDED" as const,
      unallocatedReward: 25_000_000n,
    };
    expect(evaluateCoverage(observation(), terms, [bounty], [], now).status).toBe("NO_ACTION");
    expect(
      evaluateCoverage(observation(), terms, [{ ...bounty, state: "QUALIFIED" }], [], now)
        .reasonCode,
    ).toBe("NO_APPROVED_POLICY");
    expect(
      evaluateCoverage(observation(), terms, [{ ...bounty, asset: address }], [], now).reasonCode,
    ).toBe("UNSUPPORTED_UNITS");
  });
  it("Keeps funding disabled without an exact approved policy", () => {
    const result = evaluateCoverage(observation(), terms, [], [], now);
    expect(result.status).toBe("ABSTAIN");
    expect(result.proposedAction).toBeNull();
    expect(explainDeterministically(result)).toContain(result.sourceIds[0]);
  });
});
