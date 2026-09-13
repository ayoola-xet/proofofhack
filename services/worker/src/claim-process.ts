import type { Pool, PoolClient } from "pg";
import { erc20Abi, type Hex, parseEventLogs } from "viem";
import { bountyEscrowAbi } from "../../../packages/chain/src/abi/BountyEscrow.ts";
import type { BountyReader } from "../../../packages/chain/src/bounty-reader.ts";
import { type ClaimCall, claimCallSchema } from "../../../packages/chain/src/claim-calls.ts";
import type { FundingReceipt } from "../../../packages/chain/src/funding.ts";
import { hashCanonical } from "../../../packages/crypto-envelope/src/index.ts";
import {
  bytes32,
  DomainError,
  LARGE_PAYOUT_REQUIRED_APPROVALS,
  LARGE_PAYOUT_THRESHOLD,
  policySchema,
} from "../../../packages/domain/src/index.ts";
import type { InternalClient } from "../../../packages/service-auth/src/http.ts";
import { first } from "../../api/src/context.ts";

export interface ClaimRelayer {
  walletId: string;
  send(
    key: string,
    escrow: Hex,
    call: ClaimCall,
    requestId: string,
  ): Promise<{ hash: Hex; providerId: string }>;
}
export type ClaimChain = BountyReader & {
  finalReceipt(hash: Hex): Promise<FundingReceipt | null>;
  findPaid(
    policy: ReturnType<typeof policySchema.parse>,
    claimId: Hex,
    fromBlock: bigint,
  ): Promise<FundingReceipt | null>;
};
export async function processClaim(
  pool: Pool,
  chain: ClaimChain,
  relayers: Record<string, ClaimRelayer>,
  verifiers: Record<string, Pick<InternalClient, "post">>,
  release: Pick<InternalClient, "post">,
  claimId: string,
) {
  bytes32.parse(claimId);
  const c = await pool.connect();
  let lock: string | undefined;
  try {
    const row = await first(
      c,
      "select c.*,b.policy_json,b.policy_hash,p.organization_id from claims c join bounties b on b.bounty_id=c.bounty_id join programs p on p.id=b.program_id where c.claim_id=$1",
      [claimId],
    );
    lock = `claim-lifecycle:${row.bounty_id}`;
    if (
      !(await c.query("select pg_try_advisory_lock(hashtextextended($1,0)) as locked", [lock]))
        .rows[0].locked
    ) {
      lock = undefined;
      throw new Error("Another claim is being processed for this bounty.");
    }
    const policy = policySchema.parse(row.policy_json);
    const relayer = relayers[policy.adapterId];
    if (!relayer)
      throw new DomainError(
        "RELAYER_NOT_CONFIGURED",
        "No settlement wallet is configured for this bounty's adapter.",
      );
    const releaseIfPaid = async () => {
      const report = (
        await c.query(
          "select r.id,r.state,e.id as event_id from reports r join chain_events e on e.name='Paid' and e.finality_state='FINAL' and e.payload_json->>'claimId'=r.claim_id where r.claim_id=$1 order by e.created_at desc limit 1",
          [claimId],
        )
      ).rows[0];
      if (report && !["AVAILABLE", "DELETING", "DELETED"].includes(report.state))
        await release.post("/internal/report-releases", {
          reportId: report.id,
          eventId: report.event_id,
        });
    };
    if (row.job_state === "SETTLED") {
      await releaseIfPaid();
      return { state: "SETTLED" };
    }
    if (["UPLOADING", "EXPIRED", "ADMISSION_EXPIRED", "INVALID_FIXTURE"].includes(row.job_state))
      return { state: row.job_state };
    const current = await chain.read(policy);
    if (current.state === 1 && ["ADMISSION_PENDING", "RESERVING"].includes(row.job_state)) {
      const saved = (
        await c.query(
          "select * from transaction_intents where wallet_id=$1 and idempotency_key=$2",
          [relayer.walletId, `${claimId}:reserveClaim`],
        )
      ).rows[0];
      if (saved) {
        const request = saved.request_json;
        const call = claimCallSchema.parse(request.call);
        if (
          hashCanonical(request) !== saved.request_hash ||
          request.claimId !== claimId ||
          request.escrow !== policy.escrow ||
          request.chainId !== policy.settlementChainId ||
          call.method !== "reserveClaim" ||
          call.payload.claimId !== claimId ||
          call.payload.bountyId !== row.bounty_id
        )
          throw new DomainError(
            "CLAIM_INTENT_MISMATCH",
            "The saved admission does not match this claim.",
          );
        if (current.timestamp > BigInt(call.payload.validUntil)) {
          await c.query("begin");
          try {
            await c.query(
              "update claims set job_state='ADMISSION_EXPIRED',updated_at=now() where claim_id=$1",
              [claimId],
            );
            await c.query(
              "update transaction_intents set state='EXPIRED',updated_at=now() where id=$1",
              [saved.id],
            );
            await c.query("update admissions set state='EXPIRED' where claim_id=$1", [claimId]);
            await c.query("commit");
          } catch (error) {
            await c.query("rollback");
            throw error;
          }
          return { state: "ADMISSION_EXPIRED" };
        }
      }
    }
    if (
      current.state === 2 &&
      current.reservation.claimId === claimId &&
      current.timestamp > current.reservation.expiresAt
    ) {
      await c.query("begin");
      try {
        await c.query(
          "update claims set job_state='RECOVERY_PENDING',updated_at=now() where claim_id=$1 and job_state not in('SETTLED','EXPIRED','RECOVERY_PENDING')",
          [claimId],
        );
        await c.query(
          "insert into outbox(deduplication_key,event_type,aggregate_id,payload_json) values($1,'RECOVERY_PROCESS',$2,$3) on conflict(deduplication_key) do nothing",
          [
            `claim-expiry-recovery:${claimId}`,
            row.bounty_id,
            JSON.stringify({ bountyId: row.bounty_id }),
          ],
        );
        await c.query("commit");
      } catch (error) {
        await c.query("rollback");
        throw error;
      }
      return { state: "RECOVERY_PENDING" };
    }
    const step = async (method: ClaimCall["method"]): Promise<FundingReceipt> => {
      const key = `${claimId}:${method}`;
      let intent = (
        await c.query(
          "select * from transaction_intents where wallet_id=$1 and idempotency_key=$2",
          [relayer.walletId, key],
        )
      ).rows[0];
      let externalReceipt: FundingReceipt | null = null;
      if (method === "collectPayment") {
        const qualified = await first(
          c,
          "select block_number from chain_events where chain_id=$1 and contract_address=$2 and name='ClaimQualified' and finality_state='FINAL' and payload_json->>'claimId'=$3 order by block_number desc limit 1",
          [policy.settlementChainId, policy.escrow, claimId],
        );
        externalReceipt = await chain.findPaid(
          policy,
          bytes32.parse(claimId),
          BigInt(qualified.block_number),
        );
      }
      if (!intent && !externalReceipt) {
        const verifier = verifiers[policy.adapterId];
        if (!verifier)
          throw new DomainError(
            "VERIFIER_NOT_CONFIGURED",
            "No verifier is configured for this bounty's adapter.",
          );
        const response =
          method === "collectPayment"
            ? { payload: { bountyId: row.bounty_id } }
            : await verifier.post<{ payload: Record<string, string>; signature: Hex }>(
                method === "reserveClaim" ? "/internal/admissions" : "/internal/assessments",
                { claimId },
              );
        const call = claimCallSchema.parse({ method, ...response });
        if (
          call.payload.bountyId !== row.bounty_id ||
          ("claimId" in call.payload &&
            (call.payload.claimId !== claimId ||
              call.payload.claimant !== row.claimant_address ||
              call.payload.evidenceCommitment !== row.evidence_commitment))
        )
          throw new DomainError(
            "CLAIM_BINDING_MISMATCH",
            "The signed service response does not match this claim.",
          );
        const request = { escrow: policy.escrow, chainId: policy.settlementChainId, claimId, call };
        intent = await first(
          c,
          "insert into transaction_intents(chain_id,provider,wallet_id,purpose,request_hash,idempotency_key,state,request_json) values($1,'CIRCLE',$2,$3,$4,$5,'PREPARED',$6) returning *",
          [
            policy.settlementChainId,
            relayer.walletId,
            `CLAIM_${method}`,
            hashCanonical(request),
            key,
            JSON.stringify(request),
          ],
        );
      }
      let call: ClaimCall = { method: "collectPayment", payload: { bountyId: row.bounty_id } };
      let receipt = externalReceipt;
      if (!externalReceipt) {
        const request = intent.request_json;
        call = claimCallSchema.parse(request.call);
        /* persisted transaction validation */

        if (
          hashCanonical(request) !== intent.request_hash ||
          request.claimId !== claimId ||
          request.escrow !== policy.escrow ||
          request.chainId !== policy.settlementChainId ||
          call.method !== method ||
          call.payload.bountyId !== row.bounty_id
        )
          throw new DomainError(
            "CLAIM_INTENT_MISMATCH",
            "The saved claim transaction does not match.",
          );
        if (!intent.transaction_hash) {
          if (Date.now() - intent.created_at.getTime() > 23 * 3600000)
            throw new DomainError(
              "RECONCILIATION_REQUIRED",
              "The Circle request needs operator reconciliation before another provider call.",
            );
          await c.query(
            "update transaction_intents set state='SUBMITTED',updated_at=now() where id=$1",
            [intent.id],
          );
          const sent = await relayer.send(intent.idempotency_key, policy.escrow, call, intent.id);
          bytes32.parse(sent.hash);
          await c.query(
            "update transaction_intents set transaction_hash=$2,provider_request_id=$3,state='BROADCAST',updated_at=now() where id=$1",
            [intent.id, sent.hash, sent.providerId],
          );
          intent.transaction_hash = sent.hash;
        }
        receipt = await chain.finalReceipt(intent.transaction_hash);
      }
      if (!receipt)
        throw new DomainError(
          "AWAITING_FINALITY",
          "The saved claim transaction awaits a final receipt.",
          503,
        );
      if (
        (!externalReceipt && receipt.hash !== intent.transaction_hash) ||
        receipt.status !== "success"
      )
        throw new DomainError(
          "CLAIM_TRANSACTION_FAILED",
          "The saved claim transaction did not complete successfully.",
        );
      const expected =
        method === "reserveClaim"
          ? "ClaimReserved"
          : method === "collectPayment"
            ? "Paid"
            : call.method === "submitAssessment" && call.payload.outcome === "1"
              ? "ClaimQualified"
              : "ClaimRejected";
      const events = parseEventLogs({
        abi: bountyEscrowAbi,
        logs: receipt.logs.filter((l) => l.address.toLowerCase() === policy.escrow),
        strict: true,
      });
      const event = events.find(
        (e) =>
          e.eventName === expected &&
          "bountyId" in e.args &&
          e.args.bountyId === row.bounty_id &&
          "claimId" in e.args &&
          e.args.claimId === claimId,
      );
      if (!event)
        throw new DomainError(
          "CLAIM_EVENT_MISMATCH",
          "The final receipt does not contain the matching claim event.",
        );
      if (
        event.eventName === "ClaimReserved" &&
        (event.args.claimant.toLowerCase() !== row.claimant_address ||
          event.args.evidenceCommitment !== row.evidence_commitment)
      )
        throw new DomainError(
          "CLAIM_EVENT_MISMATCH",
          "The reservation does not match the claimant or evidence.",
        );
      if (
        event.eventName === "ClaimQualified" &&
        (call.method !== "submitAssessment" ||
          event.args.claimant.toLowerCase() !== row.claimant_address ||
          event.args.reward !== BigInt(policy.reward) ||
          event.args.reportHash !== call.payload.reportHash)
      )
        throw new DomainError(
          "CLAIM_EVENT_MISMATCH",
          "Qualification does not match the signed report and reward.",
        );
      if (event.eventName === "Paid") {
        const transfer = parseEventLogs({
          abi: erc20Abi,
          eventName: "Transfer",
          logs: receipt.logs.filter((l) => l.address.toLowerCase() === policy.asset),
          strict: true,
        }).some(
          (l) =>
            l.args.from.toLowerCase() === policy.escrow &&
            l.args.to.toLowerCase() === row.claimant_address &&
            l.args.value === BigInt(policy.reward),
        );
        if (
          event.args.claimant.toLowerCase() !== row.claimant_address ||
          event.args.asset.toLowerCase() !== policy.asset ||
          event.args.amount !== BigInt(policy.reward) ||
          !transfer
        )
          throw new DomainError(
            "PAYMENT_EVENT_MISMATCH",
            "The final receipt does not prove the fixed reward transfer.",
          );
      }
      const payload = Object.fromEntries(
        Object.entries(event.args).map(([k, v]) => [
          k,
          typeof v === "bigint" ? String(v) : typeof v === "string" ? v.toLowerCase() : v,
        ]),
      );
      await saveEvent(
        c,
        {
          claimId,
          bountyId: row.bounty_id,
          organizationId: row.organization_id,
          researcherId: row.researcher_user_id,
          chainId: policy.settlementChainId,
          escrow: policy.escrow,
          reward: policy.reward,
          asset: policy.asset,
          intentId: externalReceipt ? undefined : intent.id,
        },
        receipt,
        event.logIndex,
        event.eventName,
        payload,
      );
      if (externalReceipt && intent)
        await c.query(
          "update transaction_intents set state='RECONCILED',updated_at=now() where id=$1 and state<>'CONFIRMED'",
          [intent.id],
        );
      return receipt;
    };
    await step("reserveClaim");
    await step("submitAssessment");
    const assessment = await first(
      c,
      "select outcome,payload_json->>'reward' as reward from assessments where claim_id=$1",
      [claimId],
    );
    if (assessment.outcome === "QUALIFIES") {
      if (BigInt(assessment.reward) >= LARGE_PAYOUT_THRESHOLD) {
        const approval = await first(
          c,
          `insert into payout_approvals(claim_id,organization_id,reward,required_approvals,expires_at)
           values($1,$2,$3,$4,now()+interval '7 days')
           on conflict(claim_id) do update set updated_at=payout_approvals.updated_at
           returning id,state,(select count(*)::int from payout_approval_signatures where approval_id=payout_approvals.id) as signatures`,
          [claimId, row.organization_id, assessment.reward, LARGE_PAYOUT_REQUIRED_APPROVALS],
        );
        if (approval.state !== "APPROVED" && approval.signatures < LARGE_PAYOUT_REQUIRED_APPROVALS) {
          await c.query(
            "update claims set job_state='AWAITING_QUORUM',updated_at=now() where claim_id=$1 and job_state not in('SETTLED','EXPIRED')",
            [claimId],
          );
          return { state: "AWAITING_QUORUM" };
        }
      }
      await step("collectPayment");
      await releaseIfPaid();
    }
    return { state: "SETTLED" };
  } catch (error) {
    if (error instanceof DomainError && error.code === "INVALID_FIXTURE")
      await c.query(
        "update claims set job_state='INVALID_FIXTURE',updated_at=now() where claim_id=$1 and job_state in('ADMISSION_PENDING','RESERVING')",
        [claimId],
      );
    throw error;
  } finally {
    if (lock) await c.query("select pg_advisory_unlock(hashtextextended($1,0))", [lock]);
    c.release();
  }
}
async function saveEvent(
  c: PoolClient,
  context: {
    claimId: string;
    bountyId: string;
    organizationId: string;
    researcherId: string;
    chainId: string;
    escrow: string;
    reward: string;
    asset: string;
    intentId?: string;
  },
  receipt: FundingReceipt,
  index: number | null,
  name: string,
  payload: Record<string, unknown>,
) {
  if (index === null) throw new Error("A final event needs its log index.");
  const states: Record<
    string,
    { chain: string; job: string; unallocated: string; credit: string }
  > = {
    ClaimReserved: { chain: "RESERVED", job: "RESERVED", unallocated: context.reward, credit: "0" },
    ClaimRejected: { chain: "FUNDED", job: "SETTLED", unallocated: context.reward, credit: "0" },
    ClaimQualified: {
      chain: "QUALIFIED",
      job: "SETTLEMENT_PENDING",
      unallocated: "0",
      credit: context.reward,
    },
    Paid: { chain: "PAID", job: "SETTLED", unallocated: "0", credit: "0" },
  };
  const state = states[name];
  if (!state) throw new Error("Unsupported claim event.");
  await c.query("begin");
  try {
    const event = await first(
      c,
      "insert into chain_events(chain_id,contract_address,transaction_hash,log_index,block_number,block_hash,name,payload_json,finality_state) values($1,$2,$3,$4,$5,$6,$7,$8,'FINAL') on conflict(chain_id,transaction_hash,log_index) do update set updated_at=now() returning id",
      [
        context.chainId,
        context.escrow,
        receipt.hash,
        index,
        receipt.blockNumber.toString(),
        receipt.blockHash,
        name,
        JSON.stringify(payload),
      ],
    );
    await c.query(
      "update bounties set chain_state=$2,unallocated_reward=$3,claimant_credit=$4,last_event_key=$5,updated_at=now() where bounty_id=$1 and (last_event_key is null or exists(select 1 from chain_events e where e.id::text=bounties.last_event_key and (e.block_number<$6 or(e.block_number=$6 and e.log_index<$7))))",
      [
        context.bountyId,
        state.chain,
        state.unallocated,
        state.credit,
        event.id,
        receipt.blockNumber.toString(),
        index,
      ],
    );
    if (name !== "ClaimReserved")
      await c.query(
        "update claims set job_state=$2,updated_at=now() where claim_id=$1 and job_state not in('SETTLED','EXPIRED')",
        [context.claimId, state.job],
      );
    else
      await c.query(
        "update claims set job_state='RESERVED',reservation_expiry=$2,updated_at=now() where claim_id=$1 and job_state in('ADMISSION_PENDING','RESERVING')",
        [context.claimId, new Date(Number(payload.expiresAt) * 1000)],
      );
    if (context.intentId)
      await c.query(
        "update transaction_intents set state='CONFIRMED',updated_at=now() where id=$1",
        [context.intentId],
      );
    if (name === "Paid")
      await c.query(
        "insert into receipts(organization_id,claimant_user_id,bounty_id,category,amount,asset,event_id,status) values($1,$2,$3,'PAYMENT',$4,$5,$6,'FINAL') on conflict(event_id,category) do nothing",
        [
          context.organizationId,
          context.researcherId,
          context.bountyId,
          context.reward,
          context.asset,
          event.id,
        ],
      );
    await c.query(
      "insert into outbox(deduplication_key,event_type,aggregate_id,payload_json) values($1,'COVERAGE_REFRESH',$2,$3) on conflict(deduplication_key) do nothing",
      [
        `claim-coverage:${event.id}`,
        context.organizationId,
        JSON.stringify({ organizationId: context.organizationId }),
      ],
    );
    await c.query("commit");
  } catch (error) {
    await c.query("rollback");
    throw error;
  }
}
