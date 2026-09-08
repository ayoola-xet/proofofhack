import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { type CoverageSnapshot, entrySchema, snapshotSchema, sourceSchema } from "./contract.ts";

type Database = Pick<Pool | PoolClient, "query">;
export async function loadCoverageSnapshot(
  db: Database,
  organizationId: string,
  now = new Date(),
): Promise<CoverageSnapshot> {
  const rows = (
    await db.query(
      `select distinct on (v.id) r.*,v.id as vault_id,v.address as vault_address,v.source_chain_id,
    p.max_data_age_seconds,
    (select id from coverage_policies where organization_id=r.organization_id order by version_number desc limit 1) as current_policy_id,
    o.metrics_json
    from recommendations r join registered_vaults v on v.id::text=r.calculation_json->>'vaultId' and v.organization_id=r.organization_id
    join coverage_policies p on p.id=r.policy_id and p.organization_id=r.organization_id
    left join lateral (select metrics_json from vault_observations o where o.vault_id=v.id and (o.provider_deployment_id || ':' || (o.metrics_json->>'sourceId')) in (select jsonb_array_elements_text(r.source_ids)) order by observed_block desc limit 1) o on true
    where r.organization_id=$1 order by v.id,r.created_at desc,r.id desc limit 100`,
      [z.uuid().parse(organizationId)],
    )
  ).rows;
  const entries = rows.map((row) => {
    const m = row.metrics_json,
      c = row.calculation_json;
    let sources: z.infer<typeof sourceSchema>[] = [];
    if (m) {
      const parsed = sourceSchema.safeParse({
        id: `${m.deploymentId}:${m.sourceId}`,
        deploymentId: m.deploymentId,
        observationId: m.sourceId,
        chainId: m.chainId,
        vault: m.address,
        observedBlock: m.observedBlock,
        observedHash: m.observedHash,
        observedAt: m.observedAt,
        indexedHead: m.indexedHead,
        indexedHeadAt: m.indexedHeadAt,
        asset: m.asset,
        assetDecimals: m.assetDecimals === null ? null : String(m.assetDecimals),
        totalAssets: m.totalAssets,
        totalSupply: m.totalSupply,
      });
      if (
        parsed.success &&
        parsed.data.observationId ===
          `${parsed.data.chainId}:${parsed.data.vault}:${parsed.data.observedBlock}` &&
        parsed.data.vault === row.vault_address &&
        row.source_ids.includes(parsed.data.id)
      )
        sources = [parsed.data];
    }
    let status = row.status,
      reasonCode = c.reasonCode;
    if (
      row.expires_at <= now ||
      row.policy_id !== row.current_policy_id ||
      !["ABSTAIN", "NO_ACTION", "ACTIONABLE"].includes(status)
    ) {
      status = "ABSTAIN";
      reasonCode = "EXPIRED_DECISION";
    } else if (!sources.length) {
      status = "ABSTAIN";
      reasonCode = "MISSING_OBSERVATION";
    } else {
      const source = sources[0],
        age = (now.getTime() - Date.parse(source.observedAt)) / 1000;
      const headAge = source.indexedHeadAt
        ? (now.getTime() - Date.parse(source.indexedHeadAt)) / 1000
        : Number.POSITIVE_INFINITY;
      if (age < -30 || age > row.max_data_age_seconds) {
        status = "ABSTAIN";
        reasonCode = "STALE_OBSERVATION";
      } else if (headAge < -30 || headAge > row.max_data_age_seconds) {
        status = "ABSTAIN";
        reasonCode = "STALE_INDEX_HEAD";
      } else if (
        m.readStatus !== "OK" ||
        m.hasIndexingErrors ||
        source.totalAssets === null ||
        source.totalSupply === null ||
        source.asset === null ||
        source.assetDecimals === null
      ) {
        status = "ABSTAIN";
        reasonCode = "INCOMPLETE_SOURCE";
      } else if (status === "ACTIONABLE" && row.action_json?.kind !== "FUND_APPROVED_POLICY") {
        status = "ABSTAIN";
        reasonCode = "NO_APPROVED_POLICY";
      }
    }
    const entry = entrySchema.parse({
      recommendationId: row.id,
      coveragePolicyId: row.policy_id,
      vaultId: row.vault_id,
      vault: row.vault_address,
      sourceChainId: row.source_chain_id,
      status,
      reasonCode,
      minimumReward: c.minimumReward,
      fundedReward: c.fundedReward,
      coverageGap: c.coverageGap,
      settlementAsset: c.settlementAsset,
      settlementChainId: c.settlementChainId,
      expiresAt: row.expires_at.toISOString(),
      sources,
    });
    const minimum = BigInt(entry.minimumReward),
      funded = BigInt(entry.fundedReward);
    if (BigInt(entry.coverageGap) !== (minimum > funded ? minimum - funded : 0n))
      throw new Error("The saved coverage calculation is inconsistent.");
    return entry;
  });
  return snapshotSchema.parse({
    schemaVersion: "1",
    asOf: now.toISOString(),
    entries,
    limitation:
      "Coverage measures funded fixture rewards. It does not establish vault security or a vulnerability.",
  });
}
export async function snapshotStillCurrent(
  db: Database,
  organizationId: string,
  snapshot: CoverageSnapshot,
  now = new Date(),
) {
  const current = await loadCoverageSnapshot(db, organizationId, now);
  // Ignore fetched head progress for an unchanged source observation. Compare decision and source commitments.
  const fingerprint = (value: CoverageSnapshot) =>
    JSON.stringify(
      value.entries.map(({ sources, ...entry }) => ({
        ...entry,
        sources: sources.map((s) => ({
          id: s.id,
          observedHash: s.observedHash,
          observedAt: s.observedAt,
          asset: s.asset,
          assetDecimals: s.assetDecimals,
          totalAssets: s.totalAssets,
          totalSupply: s.totalSupply,
        })),
      })),
    );
  if (fingerprint(current) !== fingerprint(snapshot)) return false;
  for (const entry of snapshot.entries) {
    const row = (
      await db.query(
        `select coalesce(sum(b.unallocated_reward),0)::text as funded from bounties b join programs p on p.id=b.program_id where p.organization_id=$1 and b.policy_json->>'sourceVault'=$2 and b.chain_id=$3 and b.policy_json->>'asset'=$4 and b.policy_json->>'sourceChainId'=$5 and b.chain_state in('FUNDED','RESERVED')`,
        [
          organizationId,
          entry.vault,
          entry.settlementChainId,
          entry.settlementAsset,
          entry.sourceChainId,
        ],
      )
    ).rows[0];
    if (BigInt(row.funded) !== BigInt(entry.fundedReward)) return false;
  }
  return true;
}
