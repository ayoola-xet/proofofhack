import type { Pool, PoolClient } from "pg";
import { type Hex, parseEventLogs } from "viem";
import { bountyEscrowAbi } from "../../../packages/chain/src/abi/BountyEscrow.ts";
import type { BountySnapshot } from "../../../packages/chain/src/bounty-reader.ts";
import {
  type RecoveryCall,
  type RecoveryScanner,
  recoveryCallSchema,
  recoveryEvents,
  recoveryRequestKey,
} from "../../../packages/chain/src/recovery.ts";
import { hashCanonical } from "../../../packages/crypto-envelope/src/index.ts";
import {
  bytes32,
  DomainError,
  hashPolicy,
  policySchema,
} from "../../../packages/domain/src/index.ts";
import { first } from "../../api/src/context.ts";
import { reconcileRecovery } from "./recovery-receipt.ts";

export interface RecoveryRelayer {
  walletId: string;
  sendRecovery(
    key: string,
    escrow: Hex,
    call: RecoveryCall,
    attempt: string,
  ): Promise<{ hash: Hex; providerId: string }>;
}
export function dueRecovery(
  bountyId: Hex,
  snapshot: BountySnapshot,
  settlementDeadline: string,
): RecoveryCall | null {
  if (
    (snapshot.state === 1 || snapshot.state === 2) &&
    snapshot.timestamp > BigInt(settlementDeadline)
  )
    return { method: "refundExpired", bountyId };
  if (snapshot.state === 2 && snapshot.timestamp > snapshot.reservation.expiresAt)
    return { method: "expireReservation", bountyId, claimId: snapshot.reservation.claimId };
  return null;
}
async function transaction<T>(c: PoolClient, run: () => Promise<T>) {
  await c.query("begin");
  try {
    const result = await run();
    await c.query("commit");
    return result;
  } catch (error) {
    await c.query("rollback");
    throw error;
  }
}
export async function processRecovery(
  pool: Pool,
  chain: RecoveryScanner,
  relayer: RecoveryRelayer,
  bountyId: Hex,
  batch = { blocks: 2000n, pages: 5 },
) {
  bytes32.parse(bountyId);
  if (
    batch.blocks < 1n ||
    batch.blocks > 2000n ||
    !Number.isInteger(batch.pages) ||
    batch.pages < 1 ||
    batch.pages > 5
  )
    throw new DomainError("RECOVERY_RANGE", "Use at most five pages of 2000 blocks per check.");
  const c = await pool.connect(),
    lock = `claim-lifecycle:${bountyId}`;
  let locked = false;
  const status = async (state: string, code: string | null = null) => {
    await c.query(
      "update bounty_recovery set status=$2,failure_code=$3,next_check_at=now()+interval '1 minute',version=version+1,updated_at=now() where bounty_id=$1",
      [bountyId, state, code],
    );
    return { status: state, code };
  };
  try {
    locked = (
      await c.query("select pg_try_advisory_lock(hashtextextended($1,0)) as locked", [lock])
    ).rows[0].locked;
    if (!locked) return { status: "BUSY", code: null };
    const bounty = await first(c, "select * from bounties where bounty_id=$1", [bountyId]);
    await c.query("insert into bounty_recovery(bounty_id) values($1) on conflict do nothing", [
      bountyId,
    ]);
    let state = await first(c, "select * from bounty_recovery where bounty_id=$1", [bountyId]);
    if (state.status === "NEEDS_REVIEW")
      return { status: "NEEDS_REVIEW", code: state.failure_code };
    const policy = policySchema.parse(bounty.policy_json);
    if (
      hashPolicy(policy) !== bountyId ||
      policy.escrow !== bounty.escrow ||
      policy.settlementChainId !== bounty.chain_id ||
      policy.reward !== bounty.reward
    )
      throw new DomainError("RECOVERY_POLICY_MISMATCH", "The saved bounty policy needs review.");
    let snapshot = await chain.read(policy);
    const scannedState = snapshot.state;
    const initialCheckpoint =
      state.checkpoint_block === null ? null : BigInt(state.checkpoint_block);
    let from: bigint;
    if (initialCheckpoint !== null) {
      if (
        initialCheckpoint > snapshot.blockNumber ||
        (await chain.blockHash(initialCheckpoint)) !== state.checkpoint_hash
      )
        throw new DomainError(
          "RECOVERY_CHECKPOINT_CHANGED",
          "The final chain checkpoint needs review.",
        );
      from = initialCheckpoint + 1n;
    } else {
      const funded = await chain.finalReceipt(bytes32.parse(bounty.creation_tx));
      if (funded?.status !== "success")
        throw new DomainError(
          "RECOVERY_FUNDING_NOT_FINAL",
          "The funding receipt is not final yet.",
          503,
        );
      const events = parseEventLogs({
        abi: bountyEscrowAbi,
        eventName: "BountyFunded",
        logs: funded.logs.filter((l) => l.address.toLowerCase() === policy.escrow),
        strict: true,
      });
      if (
        !events.some(
          (e) =>
            e.args.bountyId === bountyId &&
            e.args.policyHash === bountyId &&
            e.args.organizationId === policy.organizationId &&
            e.args.asset.toLowerCase() === policy.asset &&
            String(e.args.reward) === policy.reward,
        )
      )
        throw new DomainError(
          "RECOVERY_FUNDING_MISMATCH",
          "The funding receipt does not match this bounty.",
        );
      from = funded.blockNumber;
    }
    // Commit one bounded page at a time. A restart resumes the next block.
    for (let page = 0; page < batch.pages && from <= snapshot.blockNumber; page++) {
      const end =
        from + batch.blocks - 1n < snapshot.blockNumber
          ? from + batch.blocks - 1n
          : snapshot.blockNumber;
      const endHash = await chain.blockHash(end),
        hashes = await chain.recoveryRange(policy, from, end);
      await transaction(c, async () => {
        for (const hash of hashes) await reconcileRecovery(c, chain, bountyId, hash);
        if ((await chain.blockHash(end)) !== endHash)
          throw new DomainError(
            "RECOVERY_CHECKPOINT_CHANGED",
            "The final chain checkpoint needs review.",
          );
        await c.query(
          "update bounty_recovery set checkpoint_block=$2,checkpoint_hash=$3,updated_at=now() where bounty_id=$1",
          [bountyId, String(end), endHash],
        );
      });
      from = end + 1n;
    }
    if (from <= snapshot.blockNumber) return status("SCANNING");
    snapshot = await chain.read(policy);
    await c.query("update bounty_recovery set observed_state=$2 where bounty_id=$1", [
      bountyId,
      String(snapshot.state),
    ]);
    state = await first(c, "select * from bounty_recovery where bounty_id=$1", [bountyId]);
    let intent = state.active_intent_id
      ? await first(c, "select * from transaction_intents where id=$1", [state.active_intent_id])
      : null;
    const due = dueRecovery(bountyId, snapshot, policy.settlementDeadline);
    if (!intent && !due) {
      if ([3, 4, 5].includes(snapshot.state))
        return status([3, 4, 5].includes(scannedState) ? "COMPLETE" : "SCANNING");
      return status("WAITING");
    }
    if (!intent) {
      const call = recoveryCallSchema.parse(due);
      const count = await first(
        c,
        "select count(*) from transaction_intents where purpose=$1 and request_json->'call'=$2::jsonb",
        [`RECOVERY_${call.method}`, JSON.stringify(call)],
      );
      const attempt = String(Number(count.count) + 1);
      if (BigInt(attempt) > 5n)
        throw new DomainError(
          "RECOVERY_ATTEMPT_LIMIT",
          "Five recovery transactions failed. Review the saved receipts.",
        );
      const key = recoveryRequestKey(call, attempt),
        request = {
          bountyId,
          escrow: policy.escrow,
          chainId: policy.settlementChainId,
          call,
          attempt,
        };
      intent = await transaction(c, async () => {
        const row = await first(
          c,
          "insert into transaction_intents(chain_id,provider,wallet_id,purpose,request_hash,idempotency_key,state,request_json) values($1,'CIRCLE',$2,$3,$4,$5,'PREPARED',$6) returning *",
          [
            policy.settlementChainId,
            relayer.walletId,
            `RECOVERY_${call.method}`,
            hashCanonical(request),
            key,
            JSON.stringify(request),
          ],
        );
        await c.query(
          "update bounty_recovery set active_intent_id=$2,status='PREPARED',failure_code=null where bounty_id=$1",
          [bountyId, row.id],
        );
        return row;
      });
    }
    const request = intent.request_json,
      call = recoveryCallSchema.parse(request.call);
    if (
      hashCanonical(request) !== intent.request_hash ||
      request.bountyId !== bountyId ||
      request.chainId !== policy.settlementChainId ||
      request.escrow !== policy.escrow ||
      call.bountyId !== bountyId ||
      intent.chain_id !== policy.settlementChainId ||
      intent.provider !== "CIRCLE" ||
      intent.wallet_id !== relayer.walletId ||
      intent.purpose !== `RECOVERY_${call.method}` ||
      intent.idempotency_key !== recoveryRequestKey(call, request.attempt)
    )
      throw new DomainError("RECOVERY_INTENT_MISMATCH", "The saved recovery request needs review.");
    const finish = async (intentState: string) => {
      await transaction(c, async () => {
        await c.query("update transaction_intents set state=$2,updated_at=now() where id=$1", [
          intent.id,
          intentState,
        ]);
        await c.query("update bounty_recovery set active_intent_id=null where bounty_id=$1", [
          bountyId,
        ]);
      });
    };
    if (!intent.transaction_hash) {
      // An external final event can resolve a lost provider response without another send.
      const completed = (
        await c.query(
          "select id from chain_events where chain_id=$1 and contract_address=$2 and finality_state='FINAL' and name=$3 and payload_json->>'bountyId'=$4 and ($5::text is null or payload_json->>'claimId'=$5) limit 1",
          [
            policy.settlementChainId,
            policy.escrow,
            call.method === "refundExpired" ? "BountyRefunded" : "ReservationExpired",
            bountyId,
            "claimId" in call ? call.claimId : null,
          ],
        )
      ).rows[0];
      if (completed) {
        await finish("RECONCILED");
        return status("WAITING");
      }
      if (Date.now() - intent.created_at.getTime() > 23 * 3600000)
        throw new DomainError(
          "RECONCILIATION_REQUIRED",
          "The Circle request is too old to resend safely.",
        );
      if (!due || hashCanonical(due) !== hashCanonical(call)) {
        if (intent.state === "PREPARED") {
          await finish("CANCELLED");
          return status("WAITING");
        }
        throw new DomainError(
          "RECONCILIATION_REQUIRED",
          "The bounty changed before the Circle request resolved.",
        );
      }
      await c.query(
        "update transaction_intents set state='SUBMITTED',updated_at=now() where id=$1",
        [intent.id],
      );
      const sent = await relayer.sendRecovery(
        intent.idempotency_key,
        policy.escrow,
        call,
        request.attempt,
      );
      bytes32.parse(sent.hash);
      await c.query(
        "update transaction_intents set transaction_hash=$2,provider_request_id=$3,state='BROADCAST',updated_at=now() where id=$1",
        [intent.id, sent.hash, sent.providerId],
      );
      intent.transaction_hash = sent.hash;
    }
    const receipt = await chain.finalReceipt(bytes32.parse(intent.transaction_hash));
    if (!receipt) return status("CONFIRMING");
    if (receipt.hash !== intent.transaction_hash)
      throw new DomainError(
        "RECOVERY_EVENT_MISMATCH",
        "The recovery receipt has a different hash.",
      );
    if (receipt.status === "reverted") {
      await finish("FAILED");
      return status("RETRYING", "RECOVERY_TRANSACTION_REVERTED");
    }
    const events = recoveryEvents(receipt, policy);
    if (
      !events.some((event) =>
        call.method === "refundExpired"
          ? event.eventName === "BountyRefunded"
          : event.eventName === "ReservationExpired" && event.args.claimId === call.claimId,
      )
    )
      throw new DomainError(
        "RECOVERY_EVENT_MISMATCH",
        "The receipt does not match the saved recovery action.",
      );
    await transaction(c, async () => {
      await reconcileRecovery(c, chain, bountyId, receipt.hash);
      await c.query(
        "update transaction_intents set state='CONFIRMED',updated_at=now() where id=$1",
        [intent.id],
      );
      await c.query("update bounty_recovery set active_intent_id=null where bounty_id=$1", [
        bountyId,
      ]);
    });
    return status("WAITING");
  } catch (error) {
    const code = error instanceof DomainError ? error.code : "RECOVERY_PROVIDER_UNAVAILABLE";
    const review = error instanceof DomainError && error.status !== 503;
    return await status(review ? "NEEDS_REVIEW" : "RETRYING", code);
  } finally {
    if (locked) await c.query("select pg_advisory_unlock(hashtextextended($1,0))", [lock]);
    c.release();
  }
}
