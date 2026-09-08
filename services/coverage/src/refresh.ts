import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { policySchema } from "../../../packages/domain/src/index.ts";
import type { VaultObservationDTO } from "../../../packages/erc4626-coverage-data/src/client.ts";
import {
  type ActiveCoverage,
  type ApprovedPolicy,
  evaluateCoverage,
  explainDeterministically,
} from "./engine.ts";

export type CoverageSource = { query(ids: string[]): Promise<VaultObservationDTO[]> };
export async function refreshCoverage(
  pool: Pool,
  source: CoverageSource,
  organizationId: string,
  now = new Date(),
) {
  const vaults = (
    await pool.query(
      "select id,source_chain_id,address from registered_vaults where organization_id=$1 order by id limit 100",
      [organizationId],
    )
  ).rows;
  if (!vaults.length) return { observations: 0, recommendations: 0 };
  let observations: VaultObservationDTO[];
  try {
    observations = await source.query(vaults.map((v) => `${v.source_chain_id}:${v.address}`));
  } catch (error) {
    await invalidateCoverage(pool, organizationId, "PROVIDER_UNAVAILABLE");
    throw error;
  }
  const c = await pool.connect();
  let saved = 0,
    recommended = 0;
  try {
    await c.query("begin");
    await c.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
      `coverage:${organizationId}`,
    ]);
    const org = (
      await c.query("select onchain_id from organizations where id=$1 and status='ACTIVE'", [
        organizationId,
      ])
    ).rows[0];
    if (!org) {
      await c.query("commit");
      return { observations: 0, recommendations: 0 };
    }
    const policy = (
      await c.query(
        "select * from coverage_policies where organization_id=$1 order by version_number desc limit 1",
        [organizationId],
      )
    ).rows[0];
    const bountyRows = (
      await c.query(
        "select b.* from bounties b join programs p on p.id=b.program_id where p.organization_id=$1",
        [organizationId],
      )
    ).rows;
    const active: ActiveCoverage[] = bountyRows.map((b) => ({
      sourceChainId: b.policy_json.sourceChainId,
      sourceVault: b.policy_json.sourceVault,
      organizationId: org.onchain_id,
      settlementChainId: b.chain_id,
      asset: b.policy_json.asset,
      state: b.chain_state,
      unallocatedReward: BigInt(b.unallocated_reward),
    }));
    const allocations = (
      await c.query(
        `select a.*,d.policy_json,c.enabled from approved_allocations a
      join budget_controllers c on c.id=a.controller_id
      join bounty_drafts d on d.policy_hash=a.policy_hash and d.status='APPROVED'
      join programs p on p.id=d.program_id where c.organization_id=$1 and p.organization_id=$1`,
        [organizationId],
      )
    ).rows;
    const approved: ApprovedPolicy[] = allocations.map((a) => ({
      controllerId: a.controller_id,
      policy: policySchema.parse(a.policy_json),
      policyHash: a.policy_hash,
      approvedUntil: Math.floor(a.expires_at.getTime() / 1000),
      consumed: !!a.consumed_event_ref,
      controllerEnabled: a.enabled,
    }));
    for (const vault of vaults) {
      const observation = observations.find(
        (o) => o.vaultId === `${vault.source_chain_id}:${vault.address}`,
      );
      if (!observation?.observedAt || !observation.observedBlock) {
        await c.query(
          "update coverage_records set status='ABSTAIN',reason='MISSING_OBSERVATION',computed_at=$2 where vault_id=$1",
          [vault.id, now],
        );
        await c.query(
          "update recommendations set status='ABSTAIN',action_json=null,expires_at=$3 where organization_id=$1 and calculation_json->>'vaultId'=$2",
          [organizationId, vault.id, now],
        );
        continue;
      }
      const inserted = (
        await c.query(
          `insert into vault_observations(vault_id,provider_deployment_id,schema_version,observed_block,observed_hash,indexed_head,observed_at,fetched_at,metrics_json,read_status)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict(provider_deployment_id,vault_id,observed_block)
        do update set indexed_head=excluded.indexed_head,fetched_at=excluded.fetched_at,metrics_json=excluded.metrics_json,read_status=excluded.read_status
        returning id`,
          [
            vault.id,
            observation.deploymentId,
            observation.schemaVersion,
            observation.observedBlock,
            observation.observedHash,
            observation.indexedHead,
            observation.observedAt,
            now,
            JSON.stringify(observation),
            observation.readStatus,
          ],
        )
      ).rows[0];
      saved++;
      await c.query("update registered_vaults set asset=$2,decimals=$3 where id=$1", [
        vault.id,
        observation.asset,
        observation.assetDecimals,
      ]);
      if (!policy?.allowed_vault_ids.includes(vault.id)) continue;
      const result = evaluateCoverage(
        observation,
        {
          organizationId: org.onchain_id,
          minReward: BigInt(policy.min_reward),
          settlementAsset: "0x3600000000000000000000000000000000000000",
          settlementChainId: "5042002",
          maxObservationAgeSeconds: policy.max_data_age_seconds,
          maxHeadAgeSeconds: policy.max_data_age_seconds,
          recommendationTtlSeconds: 300,
        },
        active,
        approved,
        now,
      );
      await c.query(
        `insert into coverage_records(vault_id,policy_id,source_observation_id,funded_reward,status,reason,computed_at)
        values($1,$2,$3,$4,$5,$6,$7) on conflict(vault_id,policy_id,source_observation_id)
        do update set funded_reward=excluded.funded_reward,status=excluded.status,reason=excluded.reason,computed_at=excluded.computed_at`,
        [
          vault.id,
          policy.id,
          inserted.id,
          result.calculation.fundedReward,
          result.status,
          result.reasonCode,
          now,
        ],
      );
      const fingerprint = createHash("sha256")
        .update(
          JSON.stringify({
            policyId: policy.id,
            vaultId: vault.id,
            sourceIds: result.sourceIds,
            status: result.status,
            reason: result.reasonCode,
            calculation: result.calculation,
            action: result.proposedAction,
          }),
        )
        .digest("hex");
      const same = await c.query(
        "select id from recommendations where organization_id=$1 and calculation_json->>'fingerprint'=$2 and expires_at>$3 and status=$4 limit 1",
        [organizationId, fingerprint, now, result.status],
      );
      if (same.rowCount) continue;
      await c.query(
        "update recommendations set expires_at=$3,action_json=null,status='EXPIRED' where organization_id=$1 and calculation_json->>'vaultId'=$2 and expires_at>$3",
        [organizationId, vault.id, now],
      );
      await c.query(
        `insert into recommendations(organization_id,source_ids,policy_id,calculation_json,explanation,action_json,expires_at,status)
        values($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          organizationId,
          JSON.stringify(result.sourceIds),
          policy.id,
          JSON.stringify({
            ...result.calculation,
            vaultId: vault.id,
            reasonCode: result.reasonCode,
            fingerprint,
            sourceTimes: result.sourceTimes,
            explanationMode: "DETERMINISTIC",
          }),
          explainDeterministically(result),
          result.proposedAction ? JSON.stringify(result.proposedAction) : null,
          result.expiresAt,
          result.status,
        ],
      );
      recommended++;
    }
    await c.query("commit");
    return { observations: saved, recommendations: recommended };
  } catch (error) {
    await c.query("rollback");
    throw error;
  } finally {
    c.release();
  }
}
async function invalidateCoverage(pool: Pool, organizationId: string, reason: string) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
      `coverage:${organizationId}`,
    ]);
    await c.query(
      "update coverage_records set status='ABSTAIN',reason=$2,computed_at=now() where vault_id in(select id from registered_vaults where organization_id=$1)",
      [organizationId, reason],
    );
    await c.query(
      "update recommendations set status='ABSTAIN',action_json=null,expires_at=now() where organization_id=$1 and expires_at>now()",
      [organizationId],
    );
    await c.query("commit");
  } catch (error) {
    await c.query("rollback");
    throw error;
  } finally {
    c.release();
  }
}
