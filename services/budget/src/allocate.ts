import type { Pool, PoolClient } from "pg";
import { erc20Abi, parseEventLogs } from "viem";
import { z } from "zod";
import { bountyEscrowAbi } from "../../../packages/chain/src/abi/BountyEscrow.ts";
import { fundingBudgetControllerAbi } from "../../../packages/chain/src/abi/FundingBudgetController.ts";
import type {
  BudgetChain,
  ControllerBinding,
  ControllerSnapshot,
} from "../../../packages/chain/src/budget.ts";
import type { FundingReceipt } from "../../../packages/chain/src/funding.ts";
import type { BudgetExecutor } from "../../../packages/circle/src/budget.ts";
import { hashCanonical } from "../../../packages/crypto-envelope/src/index.ts";
import {
  type BountyPolicy,
  bytes32,
  DomainError,
  hashPolicy,
  policySchema,
} from "../../../packages/domain/src/index.ts";
import { first } from "../../api/src/context.ts";
import { type ActiveCoverage, evaluateCoverage } from "../../coverage/src/engine.ts";
import type { CoverageSource } from "../../coverage/src/refresh.ts";
import { controllerContext } from "./controllers.ts";

export async function allocateBudget(
  pool: Pool,
  chain: BudgetChain,
  executor: BudgetExecutor,
  source: CoverageSource,
  actionId: string,
) {
  z.uuid().parse(actionId);
  const c = await pool.connect();
  let lock: string | undefined;
  try {
    let action = await first(c, "select * from agent_actions where id=$1", [actionId]);
    lock = `budget-allocation:${action.controller_id}`;
    if (
      !(await c.query("select pg_try_advisory_lock(hashtextextended($1,0)) as locked", [lock]))
        .rows[0].locked
    ) {
      lock = undefined;
      throw new Error("Another allocation is in progress for this controller.");
    }
    action = await first(c, "select * from agent_actions where id=$1", [actionId]);
    if (["COMPLETE", "REJECTED", "FAILED"].includes(action.state)) return { state: action.state };
    const { row: controller, binding } = await controllerContext(c, action.controller_id);
    if (controller.operator_wallet_id !== executor.walletId)
      throw new DomainError(
        "OPERATOR_MISMATCH",
        "The allocation executor does not match the controller.",
      );
    const draft = await first(
      c,
      "select d.* from bounty_drafts d join programs p on p.id=d.program_id where d.policy_hash=$1 and d.status='APPROVED' and p.organization_id=$2",
      [action.policy_hash, controller.organization_id],
    );
    const policy = policySchema.parse(draft.policy_json);
    if (
      hashPolicy(policy) !== action.policy_hash ||
      policy.refundRecipient !== binding.address ||
      policy.organizationId !== binding.organizationId ||
      policy.asset !== binding.asset ||
      policy.escrow !== binding.escrow ||
      Number(policy.settlementChainId) !== binding.chainId
    )
      throw new DomainError(
        "ALLOCATION_POLICY_MISMATCH",
        "The approved policy does not match the controller.",
      );
    let intent = action.tx_intent_id
      ? await first(c, "select * from transaction_intents where id=$1", [action.tx_intent_id])
      : null;
    if (
      intent &&
      (hashCanonical(intent.request_json) !== intent.request_hash ||
        hashPolicy(policySchema.parse(intent.request_json.policy)) !== action.policy_hash ||
        intent.request_json.controller !== binding.address ||
        intent.request_json.chainId !== String(binding.chainId) ||
        intent.chain_id !== String(binding.chainId) ||
        intent.provider !== "CIRCLE" ||
        intent.purpose !== "BUDGET_ALLOCATION" ||
        intent.idempotency_key !== `allocation:${binding.address}:${action.policy_hash}` ||
        intent.wallet_id !== executor.walletId)
    )
      throw new DomainError(
        "ALLOCATION_INTENT_MISMATCH",
        "The saved allocation transaction has different terms.",
      );
    const state = await chain.read(binding, hashPolicy(policy));
    const from = BigInt(
      intent?.request_json.fromBlock ??
        controller.limit_projection_json.deploymentProof.blockNumber,
    );
    let receipt = await chain.findAllocation(binding, hashPolicy(policy), from);
    if (!receipt && intent?.transaction_hash)
      receipt = await chain.finalReceipt(bytes32.parse(intent.transaction_hash));
    if (!receipt && !intent?.transaction_hash) {
      let sources: Record<string, unknown>;
      try {
        sources = await eligible(
          c,
          source,
          { id: controller.id, organization_id: controller.organization_id },
          binding,
          policy,
          state,
          action.recommendation_id,
        );
      } catch (error) {
        if (!intent && error instanceof DomainError) {
          await c.query(
            "update agent_actions set state='REJECTED',rejection_code=$2,updated_at=now() where id=$1",
            [actionId, error.code],
          );
          return { state: "REJECTED", code: error.code };
        }
        throw error;
      }
      if (!intent) {
        const request = {
          controller: binding.address,
          chainId: String(binding.chainId),
          policy,
          fromBlock: String(state.blockNumber),
          sources,
        };
        await c.query("begin");
        try {
          intent = await first(
            c,
            "insert into transaction_intents(chain_id,provider,wallet_id,purpose,request_hash,idempotency_key,state,request_json) values($1,'CIRCLE',$2,'BUDGET_ALLOCATION',$3,$4,'PREPARED',$5) returning *",
            [
              String(binding.chainId),
              executor.walletId,
              hashCanonical(request),
              `allocation:${binding.address}:${action.policy_hash}`,
              JSON.stringify(request),
            ],
          );
          await c.query(
            "update agent_actions set tx_intent_id=$2,state='PREPARED',updated_at=now() where id=$1",
            [actionId, intent.id],
          );
          await c.query("commit");
        } catch (error) {
          await c.query("rollback");
          throw error;
        }
      }
      if (
        hashCanonical(intent.request_json) !== intent.request_hash ||
        hashPolicy(intent.request_json.policy) !== action.policy_hash ||
        intent.request_json.controller !== binding.address ||
        intent.wallet_id !== executor.walletId
      )
        throw new DomainError(
          "ALLOCATION_INTENT_MISMATCH",
          "The saved allocation transaction has different terms.",
        );
      if (Date.now() - intent.created_at.getTime() > 23 * 3600000)
        throw new DomainError(
          "RECONCILIATION_REQUIRED",
          "The saved provider request needs operator reconciliation.",
          503,
        );
      await c.query(
        "update transaction_intents set state='SUBMITTED',updated_at=now() where id=$1",
        [intent.id],
      );
      await c.query("update agent_actions set state='SUBMITTED',updated_at=now() where id=$1", [
        actionId,
      ]);
      const sent = await executor.send(intent.idempotency_key, binding, policy);
      await c.query(
        "update transaction_intents set transaction_hash=$2,provider_request_id=$3,state='BROADCAST',updated_at=now() where id=$1",
        [intent.id, sent.hash, sent.providerId],
      );
      await c.query(
        "update agent_actions set provider_request_id=$2,state='CONFIRMING',updated_at=now() where id=$1",
        [actionId, sent.providerId],
      );
      receipt = await chain.finalReceipt(sent.hash);
    }
    if (!receipt)
      throw new DomainError(
        "AWAITING_FINALITY",
        "The saved allocation awaits a final receipt.",
        503,
      );
    if (receipt.status !== "success") {
      await c.query(
        "update agent_actions set state='FAILED',rejection_code='TRANSACTION_REVERTED',updated_at=now() where id=$1",
        [actionId],
      );
      if (intent)
        await c.query(
          "update transaction_intents set state='REVERTED',updated_at=now() where id=$1",
          [intent.id],
        );
      return { state: "FAILED" };
    }
    await saveAllocation(
      c,
      {
        actionId,
        intentId: intent?.id,
        intentHash: intent?.transaction_hash,
        controllerId: controller.id,
        organizationId: controller.organization_id,
        programId: draft.program_id,
        binding,
        policy,
      },
      receipt,
    );
    return { state: "COMPLETE" };
  } finally {
    if (lock) await c.query("select pg_advisory_unlock(hashtextextended($1,0))", [lock]);
    c.release();
  }
}
async function eligible(
  c: PoolClient,
  source: CoverageSource,
  controller: { id: string; organization_id: string },
  binding: ControllerBinding,
  policy: BountyPolicy,
  state: ControllerSnapshot,
  recommendationId: string,
): Promise<Record<string, unknown>> {
  if (!state.enabled) throw new DomainError("CONTROLLER_DISABLED", "New allocations are disabled.");
  const now = new Date(Number(state.timestamp) * 1000),
    reward = BigInt(policy.reward);
  if (
    state.approval.consumed ||
    state.approval.reward !== reward ||
    state.approval.expiresAt <= state.timestamp
  )
    throw new DomainError(
      "POLICY_NOT_APPROVED",
      "The exact policy has no current controller approval.",
    );
  if (
    reward > state.perActionLimit ||
    state.spentToday + reward > state.dailyLimit ||
    (state.lastAllocation !== 0n && state.timestamp < state.lastAllocation + state.minimumInterval)
  )
    throw new DomainError(
      "BUDGET_LIMIT",
      "The action exceeds a controller spending or interval limit.",
    );
  if (state.balance < reward)
    throw new DomainError("BUDGET_BALANCE", "The controller has insufficient unallocated funds.");
  if (state.operatorGasBalance < 50000000000000000n)
    throw new DomainError(
      "OPERATOR_GAS",
      "The Circle operator needs a gas reserve before allocation.",
    );
  const recommendation = await first(
    c,
    "select * from recommendations where id=$1 and organization_id=$2",
    [recommendationId, controller.organization_id],
  );
  const coverage = await first(
    c,
    "select * from coverage_policies where organization_id=$1 order by version_number desc limit 1",
    [controller.organization_id],
  );
  if (
    recommendation.status !== "ACTIONABLE" ||
    recommendation.expires_at <= new Date() ||
    recommendation.policy_id !== coverage.id ||
    recommendation.action_json?.controllerId !== controller.id ||
    recommendation.action_json?.policyHash !== hashPolicy(policy) ||
    !coverage.allowed_vault_ids.includes(recommendation.calculation_json.vaultId)
  )
    throw new DomainError(
      "RECOMMENDATION_EXPIRED",
      "A fresh approved coverage recommendation is required.",
    );
  const rows = (
    await c.query(
      "select b.* from bounties b join programs p on p.id=b.program_id where p.organization_id=$1",
      [controller.organization_id],
    )
  ).rows;
  const bounties: ActiveCoverage[] = rows.map((b) => ({
    sourceChainId: b.policy_json.sourceChainId,
    sourceVault: b.policy_json.sourceVault,
    organizationId: binding.organizationId,
    settlementChainId: b.chain_id,
    asset: b.policy_json.asset,
    state: b.chain_state,
    unallocatedReward: BigInt(b.unallocated_reward),
  }));
  const records = await source.query([`${policy.sourceChainId}:${policy.sourceVault}`]);
  const observation =
    records.find((r) => r.chainId === policy.sourceChainId && r.address === policy.sourceVault) ??
    null;
  const result = evaluateCoverage(
    observation,
    {
      organizationId: binding.organizationId,
      minReward: BigInt(coverage.min_reward),
      settlementAsset: binding.asset,
      settlementChainId: String(binding.chainId),
      maxObservationAgeSeconds: coverage.max_data_age_seconds,
      maxHeadAgeSeconds: coverage.max_data_age_seconds,
      recommendationTtlSeconds: 300,
    },
    bounties,
    [
      {
        controllerId: controller.id,
        policy,
        policyHash: hashPolicy(policy),
        approvedUntil: Number(state.approval.expiresAt),
        consumed: false,
        controllerEnabled: true,
      },
    ],
    now,
  );
  if (result.status !== "ACTIONABLE" || result.proposedAction?.policyHash !== hashPolicy(policy))
    throw new DomainError(
      result.reasonCode,
      "Current source data does not permit this allocation.",
    );
  return {
    sourceIds: result.sourceIds,
    sourceTimes: result.sourceTimes,
    calculation: result.calculation,
    reasonCode: result.reasonCode,
  };
}
async function saveAllocation(
  c: PoolClient,
  context: {
    actionId: string;
    intentId?: string;
    intentHash?: string;
    controllerId: string;
    organizationId: string;
    programId: string;
    binding: ControllerBinding;
    policy: BountyPolicy;
  },
  receipt: FundingReceipt,
) {
  const { binding, policy } = context,
    hash = hashPolicy(policy);
  const allocations = parseEventLogs({
    abi: fundingBudgetControllerAbi,
    eventName: "BudgetAllocated",
    logs: receipt.logs.filter((l) => l.address.toLowerCase() === binding.address),
    strict: true,
  }).filter(
    (e) =>
      e.args.controller.toLowerCase() === binding.address &&
      e.args.policyHash === hash &&
      e.args.bountyId === hash &&
      e.args.amount === BigInt(policy.reward),
  );
  const funded = parseEventLogs({
    abi: bountyEscrowAbi,
    eventName: "BountyFunded",
    logs: receipt.logs.filter((l) => l.address.toLowerCase() === binding.escrow),
    strict: true,
  }).filter(
    (e) =>
      e.args.bountyId === hash &&
      e.args.policyHash === hash &&
      e.args.organizationId === binding.organizationId &&
      e.args.asset.toLowerCase() === binding.asset &&
      e.args.reward === BigInt(policy.reward),
  );
  const transfer = parseEventLogs({
    abi: erc20Abi,
    eventName: "Transfer",
    logs: receipt.logs.filter((l) => l.address.toLowerCase() === binding.asset),
    strict: true,
  }).some(
    (e) =>
      e.args.from.toLowerCase() === binding.address &&
      e.args.to.toLowerCase() === binding.escrow &&
      e.args.value === BigInt(policy.reward),
  );
  if (allocations.length !== 1 || funded.length !== 1 || !transfer)
    throw new DomainError(
      "ALLOCATION_EVENT_MISMATCH",
      "The final receipt does not prove the exact budget allocation and reward transfer.",
    );
  await c.query("begin");
  try {
    const save = async (
      contract: string,
      event: (typeof allocations)[number] | (typeof funded)[number],
    ) =>
      first(
        c,
        "insert into chain_events(chain_id,contract_address,transaction_hash,log_index,block_number,block_hash,name,payload_json,finality_state) values($1,$2,$3,$4,$5,$6,$7,$8,'FINAL') on conflict(chain_id,transaction_hash,log_index) do update set updated_at=now() returning id",
        [
          String(binding.chainId),
          contract,
          receipt.hash,
          event.logIndex,
          String(receipt.blockNumber),
          receipt.blockHash,
          event.eventName,
          JSON.stringify(
            Object.fromEntries(
              Object.entries(event.args).map(([k, v]) => [
                k,
                typeof v === "bigint" ? String(v) : typeof v === "string" ? v.toLowerCase() : v,
              ]),
            ),
          ),
        ],
      );
    const allocation = await save(binding.address, allocations[0]),
      funding = await save(binding.escrow, funded[0]);
    await c.query(
      "insert into bounties(bounty_id,program_id,policy_hash,policy_json,chain_id,escrow,reward,unallocated_reward,chain_state,creation_tx,last_event_key) values($1,$2,$1,$3,$4,$5,$6,$6,'FUNDED',$7,$8) on conflict(bounty_id) do nothing",
      [
        hash,
        context.programId,
        JSON.stringify(policy),
        String(binding.chainId),
        binding.escrow,
        policy.reward,
        receipt.hash,
        funding.id,
      ],
    );
    await c.query(
      "update approved_allocations set consumed_event_ref=$3,updated_at=now() where controller_id=$1 and policy_hash=$2",
      [context.controllerId, hash, allocation.id],
    );
    await c.query(
      "update agent_actions set state='COMPLETE',rejection_code=null,updated_at=now() where id=$1",
      [context.actionId],
    );
    if (context.intentId) {
      if (context.intentHash && context.intentHash !== receipt.hash)
        await c.query(
          "update transaction_intents set state='RECONCILED',updated_at=now() where id=$1",
          [context.intentId],
        );
      else
        await c.query(
          "update transaction_intents set state='CONFIRMED',transaction_hash=$2,updated_at=now() where id=$1",
          [context.intentId, receipt.hash],
        );
    }
    await c.query(
      "insert into receipts(organization_id,bounty_id,category,amount,asset,event_id,status) values($1,$2,'BUDGET_ALLOCATION',$3,$4,$5,'FINAL') on conflict(event_id,category) do nothing",
      [context.organizationId, hash, policy.reward, binding.asset, allocation.id],
    );
    await c.query(
      "insert into outbox(deduplication_key,event_type,aggregate_id,payload_json) values($1,'COVERAGE_REFRESH',$2,$3) on conflict(deduplication_key) do nothing",
      [
        `allocation-coverage:${allocation.id}`,
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
