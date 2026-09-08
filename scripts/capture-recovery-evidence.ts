import "dotenv/config";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { decodeFunctionData, encodeFunctionData, parseAbi, parseEventLogs } from "viem";
import {
  entryPoint06Abi,
  entryPoint06Address,
  getUserOperationHash,
} from "viem/account-abstraction";
import { arcClient } from "../packages/chain/src/arc.ts";
import { ReadOnlyBountyChain } from "../packages/chain/src/bounty-reader.ts";
import { exactBountyFunding } from "../packages/chain/src/funding.ts";
import {
  encodeRecoveryCall,
  recoveryCallSchema,
  recoveryEvents,
  recoveryRequestKey,
} from "../packages/chain/src/recovery.ts";
import { hashCanonical } from "../packages/crypto-envelope/src/index.ts";
import { connectDatabase } from "../packages/database/src/index.ts";
import { address, bytes32, hashPolicy, policySchema } from "../packages/domain/src/index.ts";

const bountyId = bytes32.parse(process.argv[2]);
const { pool } = connectDatabase();
try {
  const bounty = (await pool.query("select * from bounties where bounty_id=$1", [bountyId]))
    .rows[0];
  assert(bounty, "The bounty does not exist.");
  const policy = policySchema.parse(bounty.policy_json);
  assert.equal(hashPolicy(policy), bountyId);
  assert.equal(policy.settlementChainId, "5042002");
  assert.equal(bounty.chain_state, "REFUNDED");
  assert.equal(bounty.unallocated_reward, "0");
  assert.equal(bounty.claimant_credit, "0");
  const chain = new ReadOnlyBountyChain("https://rpc.testnet.arc.io", 5042002, policy.escrow);
  const client = arcClient();
  const snapshot = await chain.read(policy);
  assert.equal(snapshot.state, 5);
  assert.equal(snapshot.unallocatedReward, 0n);
  assert.equal(snapshot.claimantCredit, 0n);

  const funding = (
    await pool.query(
      `select r.state,w.address from funding_requests r join bounty_drafts d on d.id=r.draft_id
    join wallets w on w.id=r.wallet_id where d.policy_hash=$1`,
      [bountyId],
    )
  ).rows;
  assert.equal(funding.length, 1, "This capture requires one direct Privy funding request.");
  assert.equal(funding[0].state, "FUNDED");
  const funded = await chain.finalReceipt(bytes32.parse(bounty.creation_tx));
  assert(funded, "The funding receipt is not final.");
  exactBountyFunding(funded, address.parse(funding[0].address), policy);

  const recovery = (
    await pool.query(
      "select status,active_intent_id,checkpoint_block,checkpoint_hash from bounty_recovery where bounty_id=$1",
      [bountyId],
    )
  ).rows[0];
  assert.equal(recovery?.status, "COMPLETE");
  assert.equal(recovery.active_intent_id, null);
  assert.equal(await chain.blockHash(BigInt(recovery.checkpoint_block)), recovery.checkpoint_hash);
  const intents = (
    await pool.query(
      "select * from transaction_intents where purpose='RECOVERY_refundExpired' and request_json->>'bountyId'=$1",
      [bountyId],
    )
  ).rows;
  assert.equal(intents.length, 1, "The evidence expects one saved refund request.");
  const intent = intents[0],
    request = intent.request_json;
  assert.equal(intent.provider, "CIRCLE");
  assert.equal(intent.state, "CONFIRMED");
  assert.equal(hashCanonical(request), intent.request_hash);
  assert.equal(request.bountyId, bountyId);
  assert.equal(request.escrow, policy.escrow);
  assert.equal(request.chainId, policy.settlementChainId);
  const call = recoveryCallSchema.parse(request.call);
  assert.equal(call.method, "refundExpired");
  assert.equal(call.bountyId, bountyId);
  assert.equal(intent.idempotency_key, recoveryRequestKey(call, request.attempt));
  const receipt = await chain.finalReceipt(bytes32.parse(intent.transaction_hash));
  assert(receipt, "The refund receipt is not final.");
  const events = recoveryEvents(receipt, policy);
  const refund = events.find((event) => event.eventName === "BountyRefunded");
  assert(refund);
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  assert.equal(block.hash, receipt.blockHash);
  assert(block.timestamp > BigInt(policy.settlementDeadline));
  assert(receipt.blockNumber > funded.blockNumber);
  const tx = await client.getTransaction({ hash: receipt.hash });
  const operator = address.parse(process.env.CIRCLE_AGENT_ADDRESS);
  const wallet = (
    await pool.query("select address,provider,chain_id from wallets where id=$1", [
      intent.wallet_id,
    ])
  ).rows[0];
  assert.equal(wallet.provider, "CIRCLE");
  assert.equal(wallet.address, operator);
  assert.equal(wallet.chain_id, "5042002");
  assert.equal(tx.to?.toLowerCase(), entryPoint06Address.toLowerCase());
  const bundled = decodeFunctionData({ abi: entryPoint06Abi, data: tx.input });
  assert.equal(bundled.functionName, "handleOps");
  assert(bundled.functionName === "handleOps");
  const operations = bundled.args[0].filter((op) => op.sender.toLowerCase() === operator);
  assert.equal(operations.length, 1);
  const operation = operations[0];
  assert.equal(
    operation.callData,
    encodeFunctionData({
      abi: parseAbi(["function execute(address dest, uint256 value, bytes func)"]),
      functionName: "execute",
      args: [policy.escrow, 0n, encodeRecoveryCall(call)],
    }),
  );
  const operationHash = getUserOperationHash({
    chainId: 5042002,
    entryPointAddress: entryPoint06Address,
    entryPointVersion: "0.6",
    userOperation: operation,
  });
  const operationEvents = parseEventLogs({
    abi: entryPoint06Abi,
    eventName: "UserOperationEvent",
    strict: true,
    logs: receipt.logs.filter(
      (log) => log.address.toLowerCase() === entryPoint06Address.toLowerCase(),
    ),
  }).filter((log) => log.args.userOpHash === operationHash);
  assert.equal(operationEvents.length, 1);
  assert.equal(operationEvents[0].args.sender.toLowerCase(), operator);
  assert.equal(operationEvents[0].args.nonce, operation.nonce);
  assert.equal(operationEvents[0].args.success, true);
  assert.equal(tx.value, 0n);
  const saved = (
    await pool.query(
      "select transaction_hash,block_hash,log_index,finality_state,payload_json from chain_events where name='BountyRefunded' and payload_json->>'bountyId'=$1",
      [bountyId],
    )
  ).rows;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].transaction_hash, receipt.hash);
  assert.equal(saved[0].block_hash, receipt.blockHash);
  assert.equal(saved[0].log_index, refund.logIndex);
  assert.equal(saved[0].finality_state, "FINAL");
  assert.equal(saved[0].payload_json.amount, policy.reward);
  assert.equal(saved[0].payload_json.refundRecipient, policy.refundRecipient);
  const receipts = (
    await pool.query(
      "select r.amount,r.status,e.transaction_hash from receipts r join chain_events e on e.id=r.event_id where r.bounty_id=$1 and r.category='REFUND'",
      [bountyId],
    )
  ).rows;
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].amount, policy.reward);
  assert.equal(receipts[0].transaction_hash, receipt.hash);
  const jobs = (
    await pool.query(
      "select id,state,completed_on from pgboss.job where name='bounty-recovery' and data->>'bountyId'=$1 and state='completed' order by completed_on desc limit 1",
      [bountyId],
    )
  ).rows;
  assert.equal(jobs.length, 1, "The recovery queue has no completed job.");
  assert(jobs[0].completed_on.getTime() / 1000 >= Number(block.timestamp));
  const claims = (
    await pool.query("select claim_id,job_state from claims where bounty_id=$1", [bountyId])
  ).rows;
  await mkdir("evidence/arc", { recursive: true });
  await writeFile(
    `evidence/arc/recovery-${bountyId}.json`,
    `${JSON.stringify(
      {
        schemaVersion: "1",
        scope: "LIVE_AUTOMATIC_BOUNTY_REFUND",
        capturedAt: new Date().toISOString(),
        baseCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
        bountyId,
        policy,
        fundingTransactionHash: funded.hash,
        refund: {
          transactionHash: receipt.hash,
          blockNumber: String(receipt.blockNumber),
          blockHash: receipt.blockHash,
          timestamp: String(block.timestamp),
          amountBaseUnits: policy.reward,
          recipient: policy.refundRecipient,
          canonicalFinalizedReceipt: true,
          exactUsdcTransfer: true,
          afterSettlementDeadline: true,
          intentId: intent.id,
          provider: intent.provider,
          exactCallVerified: true,
          entryPoint: entryPoint06Address,
          operationHash,
          operationSender: operator,
          relaySender: tx.from.toLowerCase(),
          userOperationSucceeded: true,
          savedRefundEventCount: saved.length,
          savedRefundReceiptCount: receipts.length,
        },
        finalState: {
          state: "REFUNDED",
          unallocatedReward: "0",
          claimantCredit: "0",
          blockNumber: String(snapshot.blockNumber),
          blockHash: snapshot.blockHash,
        },
        recoveryQueue: {
          status: recovery.status,
          jobId: jobs[0].id,
          completedAt: jobs[0].completed_on,
        },
        claims,
        limits: [
          "This evidence proves automatic recovery of this testnet bounty's unallocated reward.",
          "This capture does not prove reservation expiry, a worker restart during recovery, or a hosted restore.",
        ],
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(
    "Verified the final automatic refund, exact recipient, and completed recovery job.\n",
  );
} finally {
  await pool.end();
}
