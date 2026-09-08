import "dotenv/config";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { type Hex, parseEventLogs } from "viem";
import { z } from "zod";
import { bountyEscrowAbi } from "../packages/chain/src/abi/BountyEscrow.ts";
import { arcClient } from "../packages/chain/src/arc.ts";
import { assertTransferMatches, hasExactTransfer } from "../packages/chain/src/transfers.ts";
import { connectDatabase } from "../packages/database/src/index.ts";
import { bytes32 } from "../packages/domain/src/index.ts";

const intentId = z.uuid().parse(process.argv[2] ?? "b5d4d5c7-bd23-492d-9ce7-b72bc8a58848");
const claimId = process.argv[3] ? bytes32.parse(process.argv[3]) : undefined;
const { pool } = connectDatabase();
try {
  const intent = (
    await pool.query(
      "select * from transaction_intents where id=$1 and provider='PRIVY' and purpose='USER_TRANSFER'",
      [intentId],
    )
  ).rows[0];
  if (!intent?.transaction_hash) throw new Error("The demo transfer has no transaction hash.");
  const client = arcClient();
  const [tx, receipt, finalized] = await Promise.all([
    client.getTransaction({ hash: intent.transaction_hash }),
    client.getTransactionReceipt({ hash: intent.transaction_hash }),
    client.getBlock({ blockTag: "finalized" }),
  ]);
  assertTransferMatches(tx, intent.request_json);
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  if (
    receipt.status !== "success" ||
    receipt.blockHash !== block.hash ||
    finalized.number < receipt.blockNumber ||
    !hasExactTransfer(receipt.logs, intent.request_json)
  )
    throw new Error("The transfer is not final and confirmed.");
  let afterReward: Record<string, unknown> | undefined;
  if (claimId) {
    const saved = (
      await pool.query(
        "select e.* from chain_events e where e.name='Paid' and e.finality_state='FINAL' and e.payload_json->>'claimId'=$1",
        [claimId],
      )
    ).rows;
    assert.equal(saved.length, 1);
    const paid = await client.getTransactionReceipt({ hash: saved[0].transaction_hash as Hex });
    const paidBlock = await client.getBlock({ blockNumber: paid.blockNumber });
    assert.equal(paid.status, "success");
    assert.equal(paid.blockHash, paidBlock.hash);
    assert(paid.blockNumber < receipt.blockNumber);
    const event = parseEventLogs({
      abi: bountyEscrowAbi,
      eventName: "Paid",
      logs: paid.logs.filter((log) => log.address.toLowerCase() === saved[0].contract_address),
      strict: true,
    }).find((log) => log.logIndex === saved[0].log_index && log.args.claimId === claimId);
    assert(event);
    assert.equal(event.args.claimant.toLowerCase(), tx.from.toLowerCase());
    assert(BigInt(intent.request_json.amount) <= event.args.amount);
    assert(
      hasExactTransfer(paid.logs, {
        from: saved[0].contract_address,
        recipient: tx.from,
        amount: event.args.amount.toString(),
      }),
    );
    afterReward = {
      claimId,
      paymentTransactionHash: paid.transactionHash,
      paymentBlockNumber: paid.blockNumber.toString(),
      paymentBlockHash: paid.blockHash,
      paymentAmountBaseUnits: event.args.amount.toString(),
      recipientIsPaidClaimant: true,
      outgoingTransferOccursAfterPayment: true,
    };
  }
  await mkdir("evidence/privy", { recursive: true });
  await writeFile(
    process.argv[2]
      ? `evidence/privy/outgoing-transfer-${intentId}.json`
      : "evidence/privy/outgoing-transfer.json",
    `${JSON.stringify({ capturedAt: new Date().toISOString(), intentId, afterReward, provider: "Privy React SDK", network: "Arc Testnet", chainId: 5042002, from: tx.from, recipient: intent.request_json.recipient, asset: tx.to, amountBaseUnits: intent.request_json.amount, decimals: 6, transactionHash: receipt.transactionHash, blockNumber: receipt.blockNumber.toString(), blockHash: receipt.blockHash, finalizedHead: finalized.number.toString(), gasUsed: receipt.gasUsed.toString(), effectiveGasPrice: receipt.effectiveGasPrice.toString(), exactTransferEvent: true, canonicalBlock: true, status: "CONFIRMED" }, null, 2)}\n`,
  );
  process.stdout.write("Verified the final Privy outgoing transfer and saved public evidence.\n");
} finally {
  await pool.end();
}
