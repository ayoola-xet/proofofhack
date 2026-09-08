import "dotenv/config";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { type Hex, toHex } from "viem";
import { z } from "zod";
import { arcClient } from "../packages/chain/src/arc.ts";
import { ReadOnlyBudgetChain } from "../packages/chain/src/budget.ts";
import { ownerCall, ownerCommandSchema } from "../packages/chain/src/owner-command.ts";
import { connectDatabase } from "../packages/database/src/index.ts";
import { PrivyTreasury } from "../packages/privy/src/treasury.ts";
import { loadTestnetSecret } from "../packages/service-config/src/index.ts";
import { ownerContext } from "../services/budget/src/owner-context.ts";
import { ownerReceipt } from "../services/budget/src/owner-receipt.ts";

const controllerId = z.uuid().parse(process.argv[2]);
const { pool } = connectDatabase();
try {
  const { binding, wallet, config } = await ownerContext(pool, controllerId);
  const pending = await pool.query(
    "select id from owner_requests where controller_id=$1 and (permission_pending or state not in('COMPLETE','CANCELLED','EXPIRED','FAILED'))",
    [controllerId],
  );
  assert.equal(pending.rowCount, 0, "Complete the current owner action before capture.");
  const key = z
    .object({
      publicKey: z.string(),
      privateKey: z.string(),
      purpose: z.literal("PRIVY_ORGANIZATION_AUTHORIZATION"),
    })
    .parse(await loadTestnetSecret(".local/keys/privy-authorization.json"));
  const provider = new PrivyTreasury(
    z.string().min(1).parse(process.env.PRIVY_APP_ID),
    z.string().min(1).parse(process.env.PRIVY_APP_SECRET),
    key,
  );
  await provider.verify(wallet, config);
  const chain = new ReadOnlyBudgetChain("https://rpc.testnet.arc.io", 5042002, binding.escrow);
  const client = arcClient();
  const rows = (
    await pool.query(
      `select r.id,r.command_json,r.permission_pending,r.state,i.transaction_hash
    from owner_requests r join transaction_intents i on i.id=r.tx_intent_id
    where r.controller_id=$1 and r.state='COMPLETE' order by r.created_at`,
      [controllerId],
    )
  ).rows;
  assert(rows.length > 0, "No completed owner actions are available.");
  const actions = [];
  for (const row of rows) {
    const command = ownerCommandSchema.parse(row.command_json);
    const receipt = await chain.finalReceipt(row.transaction_hash as Hex);
    assert(receipt, "The owner action has no canonical final receipt.");
    const expected = ownerCall(binding.address, command);
    const transaction = await client.getTransaction({ hash: receipt.hash });
    assert.equal(transaction.from.toLowerCase(), binding.owner);
    assert.equal(transaction.to?.toLowerCase(), expected.to);
    assert.equal(transaction.input.toLowerCase(), expected.data.toLowerCase());
    assert.equal(transaction.value, 0n);
    const event = ownerReceipt(receipt, binding, command);
    assert.equal(row.permission_pending, false);
    actions.push({
      requestId: row.id,
      command,
      transactionHash: receipt.hash,
      blockNumber: receipt.blockNumber.toString(),
      blockHash: receipt.blockHash,
      canonicalFinalizedReceipt: true,
      exactTransactionVerified: true,
      exactEvent: event,
      permissionCleanupRecorded: true,
    });
  }
  const snapshot = await chain.read(binding, toHex(0, { size: 32 }));
  await mkdir("evidence/privy", { recursive: true });
  await writeFile(
    `evidence/privy/owner-actions-${controllerId}.json`,
    `${JSON.stringify(
      {
        schemaVersion: "1",
        scope: "LIVE_PRIVY_CONTROLLER_OWNER_ACTIONS",
        capturedAt: new Date().toISOString(),
        baseCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
        controllerId,
        binding,
        currentBaseProviderPolicyVerified: true,
        actions,
        currentState: {
          blockNumber: String(snapshot.blockNumber),
          blockHash: snapshot.blockHash,
          enabled: snapshot.enabled,
          balance: String(snapshot.balance),
          perActionLimit: String(snapshot.perActionLimit),
          dailyLimit: String(snapshot.dailyLimit),
          spentToday: String(snapshot.spentToday),
          minimumInterval: String(snapshot.minimumInterval),
        },
        limits: [
          "The provider check proves its current policy. Historical permission order also depends on the worker and its tests.",
          "These owner actions do not by themselves prove Circle allocation or hosted operation.",
        ],
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(
    `Verified ${actions.length} final owner actions and the restored provider policy.\n`,
  );
} finally {
  await pool.end();
}
