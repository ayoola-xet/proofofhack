import type { PoolClient } from "pg";
import { DomainError } from "../../../packages/domain/src/index.ts";
import { first } from "../../api/src/context.ts";
export async function enqueueAllocation(
  c: PoolClient,
  organizationId: string,
  recommendationId: string,
) {
  const recommendation = await first(
    c,
    "select * from recommendations where id=$1 and organization_id=$2",
    [recommendationId, organizationId],
  );
  if (
    recommendation.status !== "ACTIONABLE" ||
    recommendation.expires_at <= new Date() ||
    recommendation.action_json?.kind !== "FUND_APPROVED_POLICY"
  )
    throw new DomainError("RECOMMENDATION_EXPIRED", "Select a current funding recommendation.");
  const { controllerId, policyHash } = recommendation.action_json;
  await first(c, "select id from budget_controllers where id=$1 and organization_id=$2", [
    controllerId,
    organizationId,
  ]);
  await c.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
    `allocation-request:${controllerId}:${policyHash}`,
  ]);
  let row = (
    await c.query("select * from agent_actions where controller_id=$1 and policy_hash=$2", [
      controllerId,
      policyHash,
    ])
  ).rows[0];
  if (!row)
    row = await first(
      c,
      "insert into agent_actions(controller_id,recommendation_id,policy_hash,idempotency_key,state) values($1,$2,$3,$4,'QUEUED') returning *",
      [controllerId, recommendationId, policyHash, `budget:${controllerId}:${policyHash}`],
    );
  else if (row.state === "REJECTED" && !row.tx_intent_id)
    row = await first(
      c,
      "update agent_actions set recommendation_id=$2,state='QUEUED',rejection_code=null,updated_at=now(),version=version+1 where id=$1 returning *",
      [row.id, recommendationId],
    );
  if (["QUEUED", "PREPARED", "SUBMITTED", "CONFIRMING"].includes(row.state))
    await c.query(
      "insert into outbox(deduplication_key,event_type,aggregate_id,payload_json) values($1,'BUDGET_ALLOCATION',$2,$3) on conflict(deduplication_key) do nothing",
      [`allocation:${row.id}:${row.version}`, row.id, JSON.stringify({ actionId: row.id })],
    );
  return row;
}
