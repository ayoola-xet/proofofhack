import type { PoolClient } from "pg";
import { z } from "zod";
import { DomainError } from "../../../packages/domain/src/index.ts";
import { first } from "../../api/src/context.ts";

export async function reportAccess(
  c: Pick<PoolClient, "query">,
  actorId: string,
  reportId: string,
  mode: "either" | "researcher" | "organization" = "either",
) {
  z.uuid().parse(actorId);
  z.uuid().parse(reportId);
  const r = await first(
    c,
    `select r.*, c.researcher_user_id, c.claimant_address, c.bounty_id, b.reward, b.chain_id, b.escrow, b.policy_json, p.organization_id from reports r join claims c on c.claim_id=r.claim_id join bounties b on b.bounty_id=c.bounty_id join programs p on p.id=b.program_id where r.id=$1`,
    [reportId],
  );
  if (new Date(r.delete_after).getTime() <= Date.now())
    throw new DomainError("REPORT_EXPIRED", "The report retention period has ended.", 410);
  if (mode !== "organization" && r.researcher_user_id === actorId) {
    if (!["SEALED", "AVAILABLE"].includes(r.state))
      throw new DomainError("REPORT_NOT_READY", "The report is not ready.");
    return r;
  }
  if (mode === "researcher")
    throw new DomainError("NOT_FOUND", "This report is not available.", 404);
  // Query current membership for every stream request. Do not use a cached role.
  await first(
    c,
    "select role from memberships where organization_id=$1 and user_id=$2 and role in ('OWNER','REVIEWER') and status='ACTIVE'",
    [r.organization_id, actorId],
  );
  if (r.state !== "AVAILABLE" || !r.paid_event_ref)
    throw new DomainError("REPORT_LOCKED", "The report becomes available after final payment.");
  const payment = await first(c, "select * from chain_events where id=$1", [r.paid_event_ref]);
  const p = payment.payload_json;
  if (
    payment.name !== "Paid" ||
    payment.finality_state !== "FINAL" ||
    payment.chain_id !== r.chain_id ||
    payment.contract_address.toLowerCase() !== r.escrow.toLowerCase() ||
    p.bountyId !== r.bounty_id ||
    p.claimId !== r.claim_id ||
    p.claimant?.toLowerCase() !== r.claimant_address.toLowerCase() ||
    p.asset?.toLowerCase() !== r.policy_json.asset.toLowerCase() ||
    p.amount !== r.reward
  )
    throw new DomainError("PAYMENT_NOT_FINAL", "The matching payment is not final.");
  return r;
}

export async function releaseReport(c: PoolClient, reportId: string, eventId: string) {
  z.uuid().parse(reportId);
  z.uuid().parse(eventId);
  // Caller owns the transaction. Lock both records before checking the payment.
  const r = await first(
    c,
    `select r.*,c.bounty_id,c.claimant_address,b.chain_id,b.reward,b.policy_json,b.escrow from reports r join claims c on c.claim_id=r.claim_id join bounties b on b.bounty_id=c.bounty_id where r.id=$1 for update of r`,
    [reportId],
  );
  const event = await first(c, "select * from chain_events where id=$1 for update", [eventId]);
  const p = event.payload_json;
  if (
    event.name !== "Paid" ||
    event.finality_state !== "FINAL" ||
    event.chain_id !== r.chain_id ||
    event.contract_address.toLowerCase() !== r.escrow.toLowerCase() ||
    p.bountyId !== r.bounty_id ||
    p.claimId !== r.claim_id ||
    p.claimant?.toLowerCase() !== r.claimant_address.toLowerCase() ||
    p.asset?.toLowerCase() !== r.policy_json.asset.toLowerCase() ||
    p.amount !== r.reward
  )
    throw new DomainError("PAYMENT_NOT_FINAL", "The matching payment is not final.");
  if (r.state === "AVAILABLE") {
    if (r.paid_event_ref !== eventId)
      throw new DomainError("PAYMENT_EVENT_CONFLICT", "The report has a different payment record.");
    return r;
  }
  if (r.state !== "SEALED") throw new DomainError("REPORT_NOT_READY", "The report is not ready.");
  return first(
    c,
    "update reports set state='AVAILABLE',paid_event_ref=$2,available_at=now(),version=version+1,updated_at=now() where id=$1 returning *",
    [reportId, eventId],
  );
}
