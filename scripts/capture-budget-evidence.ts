import "dotenv/config";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { BaseError, ContractFunctionRevertedError, type Hex, parseEventLogs } from "viem";
import { z } from "zod";
import { fundingBudgetControllerAbi as abi } from "../packages/chain/src/abi/FundingBudgetController.ts";
import { arcClient } from "../packages/chain/src/arc.ts";
import { ReadOnlyBudgetChain } from "../packages/chain/src/budget.ts";
import { exactBountyFunding } from "../packages/chain/src/funding.ts";
import { contractPolicy } from "../packages/chain/src/policy.ts";
import { hashCanonical } from "../packages/crypto-envelope/src/index.ts";
import { connectDatabase } from "../packages/database/src/index.ts";
import { bytes32, hashPolicy, policySchema } from "../packages/domain/src/index.ts";
import { controllerContext } from "../services/budget/src/controllers.ts";

const actionId = z.uuid().parse(process.argv[2]);
const blockedPolicyHash = bytes32.parse(process.argv[3]);
const { pool } = connectDatabase();
try {
  const row = (
    await pool.query(
      `select a.*,i.id as intent_id,i.provider,i.transaction_hash,i.request_json,i.request_hash,
    r.source_ids,r.calculation_json,cp.max_data_age_seconds
    from agent_actions a join transaction_intents i on i.id=a.tx_intent_id
    join recommendations r on r.id=a.recommendation_id join coverage_policies cp on cp.id=r.policy_id where a.id=$1`,
      [actionId],
    )
  ).rows[0];
  assert.equal(row?.state, "COMPLETE");
  assert.equal(row.provider, "CIRCLE");
  assert.equal(hashCanonical(row.request_json), row.request_hash);
  const policy = policySchema.parse(row.request_json.policy);
  assert.equal(hashPolicy(policy), row.policy_hash);
  const { binding } = await controllerContext(pool, row.controller_id);
  assert.equal(binding.chainId, 5042002);
  assert.equal(policy.refundRecipient, binding.address);
  const chain = new ReadOnlyBudgetChain("https://rpc.testnet.arc.io", 5042002, binding.escrow);
  const client = arcClient();
  const receipt = await chain.finalReceipt(row.transaction_hash as Hex);
  assert(receipt?.status === "success", "The allocation has no final successful receipt.");
  const funded = exactBountyFunding(receipt, binding.address, policy);
  const allocations = parseEventLogs({
    abi,
    eventName: "BudgetAllocated",
    strict: true,
    logs: receipt.logs.filter((log) => log.address.toLowerCase() === binding.address),
  }).filter(
    (log) => log.args.policyHash === row.policy_hash && log.args.bountyId === row.policy_hash,
  );
  assert.equal(allocations.length, 1);
  assert.equal(allocations[0].args.controller.toLowerCase(), binding.address);
  assert.equal(allocations[0].args.amount, BigInt(policy.reward));
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  assert.equal(block.hash, receipt.blockHash);
  assert.equal(allocations[0].args.utcDayBucket, block.timestamp / 86400n);
  const sources = row.request_json.sources;
  assert(sources.sourceIds.length > 0 && sources.sourceTimes.length > 0);
  for (const time of sources.sourceTimes) {
    const age = Number(block.timestamp) - Date.parse(time) / 1000;
    assert(
      age >= 0 && age <= row.max_data_age_seconds,
      "The saved Graph observation is stale at allocation.",
    );
  }
  const fundedState = await chain.read(binding, row.policy_hash);
  assert.equal(fundedState.approval.consumed, true);
  const blocked = (
    await pool.query(
      "select policy_json from bounty_drafts where policy_hash=$1 and status='APPROVED'",
      [blockedPolicyHash],
    )
  ).rows[0];
  assert(blocked, "The limit control has no approved draft.");
  const blockedPolicy = policySchema.parse(blocked.policy_json);
  assert.equal(hashPolicy(blockedPolicy), blockedPolicyHash);
  const state = await chain.read(binding, blockedPolicyHash);
  assert.equal(state.enabled, true);
  assert.equal(state.approval.consumed, false);
  assert.equal(state.approval.reward, BigInt(blockedPolicy.reward));
  assert(state.approval.expiresAt > state.timestamp);
  assert(BigInt(blockedPolicy.reward) <= state.perActionLimit);
  assert(state.timestamp >= state.lastAllocation + state.minimumInterval);
  assert(state.spentToday + BigInt(blockedPolicy.reward) > state.dailyLimit);
  let rejected = false;
  try {
    await client.simulateContract({
      address: binding.address,
      account: binding.operator,
      abi,
      functionName: "fundApprovedPolicy",
      args: [contractPolicy(blockedPolicy)],
      blockNumber: state.blockNumber,
    });
  } catch (error) {
    assert(error instanceof BaseError);
    const revert = error.walk((cause) => cause instanceof ContractFunctionRevertedError);
    assert(revert instanceof ContractFunctionRevertedError);
    assert.equal(revert.data?.errorName, "BudgetLimitReached");
    rejected = true;
  }
  assert(rejected, "The controller did not reject the daily-limit control.");
  const blockedActions = (
    await pool.query(
      "select id,state,rejection_code,tx_intent_id from agent_actions where controller_id=$1 and policy_hash=$2",
      [row.controller_id, blockedPolicyHash],
    )
  ).rows;
  assert.equal(blockedActions.length, 1);
  assert.equal(blockedActions[0].state, "REJECTED");
  assert.equal(blockedActions[0].rejection_code, "BUDGET_LIMIT");
  assert.equal(blockedActions[0].tx_intent_id, null);
  assert.equal(
    (await pool.query("select count(*) from bounties where bounty_id=$1", [blockedPolicyHash]))
      .rows[0].count,
    "0",
  );
  await mkdir("evidence/arc", { recursive: true });
  await writeFile(
    `evidence/arc/budget-allocation-${actionId}.json`,
    `${JSON.stringify(
      {
        schemaVersion: "1",
        scope: "LIVE_GRAPH_CIRCLE_BUDGET_ALLOCATION",
        capturedAt: new Date().toISOString(),
        baseCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
        controllerId: row.controller_id,
        binding,
        allocation: {
          actionId,
          intentId: row.intent_id,
          bountyId: row.policy_hash,
          amountBaseUnits: policy.reward,
          transactionHash: receipt.hash,
          blockNumber: receipt.blockNumber.toString(),
          blockHash: receipt.blockHash,
          budgetAllocatedLogIndex: allocations[0].logIndex,
          bountyFundedLogIndex: funded.logIndex,
          canonicalFinalizedReceipt: true,
          exactUsdcTransfer: true,
          approvalConsumed: true,
          savedGraphSources: sources,
          graphFreshAtAllocation: true,
        },
        limitControl: {
          policyHash: blockedPolicyHash,
          actionId: blockedActions[0].id,
          blockNumber: state.blockNumber.toString(),
          blockHash: state.blockHash,
          approvedReward: blockedPolicy.reward,
          spentToday: state.spentToday.toString(),
          dailyLimit: state.dailyLimit.toString(),
          perActionLimit: state.perActionLimit.toString(),
          minimumIntervalElapsed: true,
          contractSimulationError: "BudgetLimitReached",
          workerRejection: "BUDGET_LIMIT",
          providerRequestCreated: false,
          testMethod:
            "Read-only eth_call at a finalized block. No rejected transaction is broadcast.",
        },
        limits: [
          "Graph supplies context. This evidence does not prove a vault vulnerability.",
          "The read-only limit check proves the deployed contract rejects the call. It is not a mined reverted transaction.",
          "Live hosted operation remains unverified.",
        ],
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(
    "Verified the final Circle allocation and the approved daily-limit rejection.\n",
  );
} finally {
  await pool.end();
}
