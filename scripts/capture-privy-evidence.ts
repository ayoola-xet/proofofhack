import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { arcClient } from "../packages/chain/src/arc.ts";
import { assertTransferMatches, hasExactTransfer } from "../packages/chain/src/transfers.ts";
import { connectDatabase } from "../packages/database/src/index.ts";

const { pool } = connectDatabase();
try {
  const intent = (
    await pool.query(
      "select * from transaction_intents where id=$1 and provider='PRIVY' and purpose='USER_TRANSFER'",
      ["b5d4d5c7-bd23-492d-9ce7-b72bc8a58848"],
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
  await mkdir("evidence/privy", { recursive: true });
  await writeFile(
    "evidence/privy/outgoing-transfer.json",
    `${JSON.stringify({ capturedAt: new Date().toISOString(), provider: "Privy React SDK", network: "Arc Testnet", chainId: 5042002, from: tx.from, recipient: intent.request_json.recipient, asset: tx.to, amountBaseUnits: intent.request_json.amount, decimals: 6, transactionHash: receipt.transactionHash, blockNumber: receipt.blockNumber.toString(), blockHash: receipt.blockHash, finalizedHead: finalized.number.toString(), gasUsed: receipt.gasUsed.toString(), effectiveGasPrice: receipt.effectiveGasPrice.toString(), exactTransferEvent: true, canonicalBlock: true, status: "CONFIRMED" }, null, 2)}\n`,
  );
  process.stdout.write("Verified the final Privy outgoing transfer and saved public evidence.\n");
} finally {
  await pool.end();
}
