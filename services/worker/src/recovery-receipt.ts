import type { PoolClient } from "pg";
import type { Hex } from "viem";
import { type RecoveryChain, recoveryEvents } from "../../../packages/chain/src/recovery.ts";
import {
  bytes32,
  DomainError,
  hashPolicy,
  policySchema,
} from "../../../packages/domain/src/index.ts";
import { first } from "../../api/src/context.ts";

// The caller owns the transaction. This lock also serializes claim settlement.
export async function reconcileRecovery(
  c: PoolClient,
  chain: RecoveryChain,
  bountyId: Hex,
  hash: Hex,
) {
  bytes32.parse(bountyId);
  bytes32.parse(hash);
  if (
    !(
      await c.query("select pg_try_advisory_xact_lock(hashtextextended($1,0)) as locked", [
        `claim-lifecycle:${bountyId}`,
      ])
    ).rows[0].locked
  )
    throw new DomainError(
      "RECOVERY_BUSY",
      "Claim settlement is active. Retry recovery later.",
      503,
    );
  const bounty = await first(
    c,
    "select b.*,p.organization_id from bounties b join programs p on p.id=b.program_id where b.bounty_id=$1 for update of b",
    [bountyId],
  );
  const policy = policySchema.parse(bounty.policy_json);
  if (
    hashPolicy(policy) !== bountyId ||
    bounty.policy_hash !== bountyId ||
    policy.escrow !== bounty.escrow ||
    policy.settlementChainId !== bounty.chain_id ||
    policy.reward !== bounty.reward
  )
    throw new DomainError("CHAIN_POLICY_MISMATCH", "The saved bounty does not match its policy.");
  const receipt = await chain.finalReceipt(hash);
  if (!receipt)
    throw new DomainError("RECOVERY_NOT_FINAL", "The recovery transaction is not final yet.", 503);
  if (receipt.hash !== hash)
    throw new DomainError(
      "RECOVERY_EVENT_MISMATCH",
      "The receipt has a different transaction hash.",
    );
  const events = recoveryEvents(receipt, policy);
  const snapshot = await chain.read(policy);
  if (snapshot.policyHash !== bountyId || snapshot.blockNumber < receipt.blockNumber)
    throw new DomainError(
      "RECOVERY_NOT_FINAL",
      "The final bounty state needs a newer chain read.",
      503,
    );
  const recorded: { id: string; name: string }[] = [];
  for (const event of events) {
    const index = event.logIndex;
    if (index === null) throw new Error("A final event needs its log index.");
    const expiry = event.eventName === "ReservationExpired";
    if (
      (!expiry &&
        (snapshot.state !== 5 ||
          snapshot.unallocatedReward !== 0n ||
          snapshot.claimantCredit !== 0n)) ||
      (expiry && snapshot.reservation.claimId === event.args.claimId)
    )
      throw new DomainError(
        "RECOVERY_STATE_MISMATCH",
        "The final state does not match the recovery event.",
      );
    const payload = Object.fromEntries(
      Object.entries(event.args).map(([k, v]) => [
        k,
        typeof v === "bigint" ? String(v) : v.toLowerCase(),
      ]),
    );
    await c.query(
      "insert into chain_events(chain_id,contract_address,transaction_hash,log_index,block_number,block_hash,name,payload_json,finality_state) values($1,$2,$3,$4,$5,$6,$7,$8,'FINAL') on conflict(chain_id,transaction_hash,log_index) do nothing",
      [
        policy.settlementChainId,
        policy.escrow,
        hash,
        index,
        String(receipt.blockNumber),
        receipt.blockHash,
        event.eventName,
        JSON.stringify(payload),
      ],
    );
    const saved = await first(
      c,
      "select * from chain_events where chain_id=$1 and transaction_hash=$2 and log_index=$3 for update",
      [policy.settlementChainId, hash, index],
    );
    if (
      saved.contract_address !== policy.escrow ||
      saved.block_number !== String(receipt.blockNumber) ||
      saved.block_hash !== receipt.blockHash ||
      saved.name !== event.eventName ||
      saved.finality_state !== "FINAL" ||
      Object.keys(saved.payload_json).length !== Object.keys(payload).length ||
      Object.entries(payload).some(([k, v]) => saved.payload_json[k] !== v)
    )
      throw new DomainError(
        "RECOVERY_EVENT_CONFLICT",
        "The saved event conflicts with the final chain receipt.",
      );
    if (expiry) {
      // Wait for an in-flight assessment before resolving its report hold.
      await c.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
        `verifier:${event.args.claimId}`,
      ]);
      const claim = (
        await c.query(
          "select claim_id,bounty_id,job_state from claims where claim_id=$1 for update",
          [event.args.claimId],
        )
      ).rows[0];
      if (claim) {
        if (claim.bounty_id !== bountyId || claim.job_state === "SETTLED")
          throw new DomainError(
            "RECOVERY_CLAIM_CONFLICT",
            "The saved claim conflicts with its final expiry.",
          );
        const paid = (
          await c.query(
            "select id from reports where claim_id=$1 and (state='AVAILABLE' or paid_event_ref is not null)",
            [claim.claim_id],
          )
        ).rows[0];
        if (paid)
          throw new DomainError(
            "RECOVERY_CLAIM_CONFLICT",
            "A paid report conflicts with this expiry.",
          );
        await c.query(
          "update claims set job_state='EXPIRED',version=version+1,updated_at=now() where claim_id=$1 and job_state<>'EXPIRED'",
          [claim.claim_id],
        );
        await c.query(
          "update reports set expiry_event_ref=$2,retention_hold=false,delete_after=case when retention_hold then now()+interval '7 days' else delete_after end,version=version+1,updated_at=now() where claim_id=$1 and state='SEALED' and expiry_event_ref is null",
          [claim.claim_id, saved.id],
        );
      }
    } else {
      await c.query(
        "insert into receipts(organization_id,bounty_id,category,amount,asset,event_id,status) values($1,$2,'REFUND',$3,$4,$5,'FINAL') on conflict(event_id,category) do nothing",
        [bounty.organization_id, bountyId, policy.reward, policy.asset, saved.id],
      );
    }
    // An old expiry can resolve its claim without replacing a newer bounty state.
    if (!expiry || snapshot.state === 1)
      await c.query(
        "update bounties set chain_state=$2,unallocated_reward=$3,claimant_credit='0',last_event_key=$4,version=version+1,updated_at=now() where bounty_id=$1 and (last_event_key is null or exists(select 1 from chain_events e where e.id::text=bounties.last_event_key and (e.block_number<$5 or (e.block_number=$5 and e.log_index<$6))))",
        [
          bountyId,
          expiry ? "FUNDED" : "REFUNDED",
          expiry ? policy.reward : "0",
          saved.id,
          String(receipt.blockNumber),
          index,
        ],
      );
    await c.query(
      "insert into outbox(deduplication_key,event_type,aggregate_id,payload_json) values($1,'COVERAGE_REFRESH',$2,$3) on conflict(deduplication_key) do nothing",
      [
        `recovery-coverage:${saved.id}`,
        bounty.organization_id,
        JSON.stringify({ organizationId: bounty.organization_id }),
      ],
    );
    recorded.push({ id: saved.id, name: event.eventName });
  }
  return { bountyId, transactionHash: hash, events: recorded, status: "FINAL" as const };
}
