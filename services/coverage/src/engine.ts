import { type BountyPolicy, hashPolicy } from "../../../packages/domain/src/index.ts";
import type { VaultObservationDTO } from "../../../packages/erc4626-coverage-data/src/client.ts";

export type CoverageTerms = {
  organizationId: string;
  minReward: bigint;
  settlementAsset: string;
  settlementChainId: string;
  maxObservationAgeSeconds: number;
  maxHeadAgeSeconds: number;
  recommendationTtlSeconds: number;
};
export type ActiveCoverage = {
  sourceChainId: string;
  sourceVault: string;
  organizationId: string;
  settlementChainId: string;
  asset: string;
  state: "FUNDED" | "RESERVED" | "QUALIFIED" | "PAID" | "REFUNDED";
  unallocatedReward: bigint;
};
export type ApprovedPolicy = {
  controllerId: string;
  policy: BountyPolicy;
  policyHash: string;
  approvedUntil: number;
  consumed: boolean;
  controllerEnabled: boolean;
};
export function evaluateCoverage(
  observation: VaultObservationDTO | null,
  terms: CoverageTerms,
  bounties: ActiveCoverage[],
  approved: ApprovedPolicy[],
  now = new Date(),
) {
  if (
    terms.minReward <= 0n ||
    terms.maxObservationAgeSeconds < 1 ||
    terms.maxHeadAgeSeconds < 1 ||
    terms.recommendationTtlSeconds < 1
  )
    throw new Error("Invalid coverage policy.");
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const sourceIds = observation ? [`${observation.deploymentId}:${observation.sourceId}`] : [];
  const calculation = {
    minimumReward: terms.minReward.toString(),
    fundedReward: "0",
    coverageGap: terms.minReward.toString(),
    settlementAsset: terms.settlementAsset,
    settlementChainId: terms.settlementChainId,
  };
  const finish = (
    status: "ABSTAIN" | "NO_ACTION" | "ACTIONABLE",
    reasonCode: string,
    action: {
      kind: "FUND_APPROVED_POLICY";
      controllerId: string;
      policyHash: string;
    } | null = null,
  ) => ({
    status,
    reasonCode,
    sourceIds,
    sourceTimes: observation?.observedAt ? [observation.observedAt] : [],
    calculation,
    proposedAction: action,
    expiresAt: new Date((nowSeconds + terms.recommendationTtlSeconds) * 1000).toISOString(),
  });
  if (!observation?.observedAt || observation.readStatus === "MISSING")
    return finish("ABSTAIN", "MISSING_OBSERVATION");
  if (observation.hasIndexingErrors) return finish("ABSTAIN", "INDEXING_ERROR");
  if (
    observation.readStatus !== "OK" ||
    !observation.asset ||
    observation.assetDecimals === null ||
    observation.totalAssets === null ||
    observation.totalSupply === null
  )
    return finish("ABSTAIN", "MISSING_ASSET_METADATA");
  const observationAge = nowSeconds - Date.parse(observation.observedAt) / 1000;
  if (
    !Number.isFinite(observationAge) ||
    observationAge < -30 ||
    observationAge > terms.maxObservationAgeSeconds
  )
    return finish("ABSTAIN", "STALE_OBSERVATION");
  if (!observation.indexedHeadAt) return finish("ABSTAIN", "MISSING_INDEX_HEAD");
  const headAge = nowSeconds - Date.parse(observation.indexedHeadAt) / 1000;
  if (!Number.isFinite(headAge) || headAge < -30 || headAge > terms.maxHeadAgeSeconds)
    return finish("ABSTAIN", "STALE_INDEX_HEAD");
  const active = bounties.filter(
    (b) =>
      b.organizationId === terms.organizationId &&
      b.sourceChainId === observation.chainId &&
      b.sourceVault.toLowerCase() === observation.address.toLowerCase() &&
      ["FUNDED", "RESERVED"].includes(b.state),
  );
  if (
    active.some(
      (b) =>
        b.asset.toLowerCase() !== terms.settlementAsset.toLowerCase() ||
        b.settlementChainId !== terms.settlementChainId ||
        b.unallocatedReward < 0n,
    )
  )
    return finish("ABSTAIN", "UNSUPPORTED_UNITS");
  const funded = active.reduce((sum, b) => sum + b.unallocatedReward, 0n);
  const gap = terms.minReward > funded ? terms.minReward - funded : 0n;
  calculation.fundedReward = funded.toString();
  calculation.coverageGap = gap.toString();
  if (gap === 0n) return finish("NO_ACTION", "FULLY_COVERED");
  const policy = approved
    .filter((a) => {
      const p = a.policy;
      return (
        !a.consumed &&
        a.controllerEnabled &&
        a.approvedUntil > nowSeconds &&
        BigInt(p.submissionDeadline) > BigInt(nowSeconds) &&
        p.organizationId === terms.organizationId &&
        p.sourceChainId === observation.chainId &&
        p.sourceVault.toLowerCase() === observation.address.toLowerCase() &&
        p.asset.toLowerCase() === terms.settlementAsset.toLowerCase() &&
        p.settlementChainId === terms.settlementChainId &&
        BigInt(p.reward) >= gap &&
        hashPolicy(p) === a.policyHash
      );
    })
    .sort((a, b) => {
      const difference = BigInt(a.policy.reward) - BigInt(b.policy.reward);
      return difference < 0n ? -1 : difference > 0n ? 1 : a.policyHash.localeCompare(b.policyHash);
    })[0];
  if (!policy) return finish("ABSTAIN", "NO_APPROVED_POLICY");
  return finish("ACTIONABLE", funded === 0n ? "MISSING_COVERAGE" : "INSUFFICIENT_COVERAGE", {
    kind: "FUND_APPROVED_POLICY",
    controllerId: policy.controllerId,
    policyHash: policy.policyHash,
  });
}
export type CoverageResult = ReturnType<typeof evaluateCoverage>;

export function explainDeterministically(result: CoverageResult): string {
  const amounts = `Required coverage: ${result.calculation.minimumReward} base units. Funded coverage: ${result.calculation.fundedReward} base units.`;
  const reason: Record<string, string> = {
    MISSING_OBSERVATION: "No usable vault observation is available.",
    INDEXING_ERROR: "The data source reports an indexing error.",
    MISSING_ASSET_METADATA: "The vault observation is incomplete.",
    STALE_OBSERVATION: "The vault observation is too old.",
    MISSING_INDEX_HEAD: "The indexed head time is missing.",
    STALE_INDEX_HEAD: "The indexed head is too old.",
    UNSUPPORTED_UNITS: "The coverage amounts use unsupported units.",
    FULLY_COVERED: "Current funding meets the approved coverage requirement.",
    NO_APPROVED_POLICY: "No eligible funding policy is approved.",
    MISSING_COVERAGE: "This vault has no active funded coverage.",
    INSUFFICIENT_COVERAGE: "Current funding is below the approved coverage requirement.",
  };
  return `${reason[result.reasonCode]} ${amounts}${result.sourceIds.length ? ` Sources: ${result.sourceIds.join(", ")}.` : ""} This result does not establish a vulnerability.`;
}
