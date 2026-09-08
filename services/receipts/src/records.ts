import { createHash } from "node:crypto";
import { erc20Abi, parseEventLogs } from "viem";
import { z } from "zod";
import { bountyEscrowAbi } from "../../../packages/chain/src/abi/BountyEscrow.ts";
import { fundingBudgetControllerAbi } from "../../../packages/chain/src/abi/FundingBudgetController.ts";
import type { FundingReceipt } from "../../../packages/chain/src/funding.ts";
import {
  address,
  bytes32,
  DomainError,
  formatMoney,
  uint,
} from "../../../packages/domain/src/index.ts";

export const categorySchema = z.enum([
  "FUNDING",
  "PAYMENT",
  "REFUND",
  "BUDGET_ALLOCATION",
  "BUDGET_DEPOSIT",
  "BUDGET_WITHDRAW",
]);
export const filtersSchema = z
  .strictObject({
    category: categorySchema.optional(),
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
  })
  .refine((v) => !v.from || !v.to || Date.parse(v.from) < Date.parse(v.to), {
    message: "Use an end time after the start time.",
  });
export const exportRecordSchema = z.strictObject({
  id: z.uuid(),
  category: categorySchema,
  amount: uint(),
  asset: address,
  chainId: z.enum(["5042002", "31337"]),
  bountyId: bytes32.nullable(),
  recordedAt: z.iso.datetime(),
  eventId: z.uuid(),
  eventName: z.string(),
  contract: address,
  transactionHash: bytes32,
  blockNumber: uint(),
  blockHash: bytes32,
  logIndex: uint(),
  payload: z.record(z.string(), z.union([z.string(), z.boolean()])),
});
const organizationSnapshotSchema = z.strictObject({
  version: z.literal("1"),
  organizationId: z.uuid(),
  requestedBy: z.uuid(),
  filters: filtersSchema,
  records: z.array(exportRecordSchema).max(1000),
});
export const exportSnapshotSchema = z.discriminatedUnion("version", [
  organizationSnapshotSchema,
  z.strictObject({
    version: z.literal("2"),
    organizationId: z.null(),
    requestedBy: z.uuid(),
    filters: filtersSchema,
    records: z
      .array(
        exportRecordSchema.refine(
          (record) => record.category === "PAYMENT" && record.bountyId !== null,
        ),
      )
      .max(1000),
  }),
]);
export type ExportRecord = z.infer<typeof exportRecordSchema>;
export const contentHash = (text: string) => createHash("sha256").update(text).digest("hex");
const events = {
  FUNDING: "BountyFunded",
  PAYMENT: "Paid",
  REFUND: "BountyRefunded",
  BUDGET_ALLOCATION: "BudgetAllocated",
  BUDGET_DEPOSIT: "Transfer",
  BUDGET_WITHDRAW: "BudgetWithdrawn",
} as const;
export function verifyExportRecord(row: ExportRecord, receipt: FundingReceipt) {
  const fail = () =>
    new DomainError("EXPORT_EVENT_MISMATCH", "A receipt does not match its final chain event.");
  if (
    receipt.status !== "success" ||
    receipt.hash !== row.transactionHash ||
    receipt.blockHash !== row.blockHash ||
    String(receipt.blockNumber) !== row.blockNumber ||
    row.eventName !== events[row.category]
  )
    throw fail();
  const logs = receipt.logs.filter((log) => log.logIndex === Number(row.logIndex));
  if (logs.length !== 1) throw fail();
  const log = logs[0];
  if (
    log.removed ||
    log.address.toLowerCase() !== row.contract ||
    log.blockHash !== receipt.blockHash ||
    log.blockNumber !== receipt.blockNumber ||
    log.transactionHash !== receipt.hash
  )
    throw fail();
  const parsed = parseEventLogs({
    abi: [...bountyEscrowAbi, ...fundingBudgetControllerAbi, ...erc20Abi],
    logs,
    strict: true,
  });
  if (parsed.length !== 1 || parsed[0].eventName !== row.eventName) throw fail();
  const args = Object.fromEntries(
    Object.entries(parsed[0].args).map(([k, v]) => [
      k,
      typeof v === "bigint" ? String(v) : typeof v === "string" ? v.toLowerCase() : v,
    ]),
  );
  const amount = args.reward ?? args.amount ?? args.value;
  if (
    amount !== row.amount ||
    BigInt(row.amount) <= 0n ||
    (args.asset !== undefined && args.asset !== row.asset) ||
    (row.category === "BUDGET_DEPOSIT" && row.contract !== row.asset) ||
    (row.bountyId !== null && args.bountyId !== row.bountyId)
  )
    throw fail();
  if (Object.entries(row.payload).some(([key, value]) => args[key] !== value)) throw fail();
}
function cell(value: string) {
  // Keep user-controlled text from becoming a spreadsheet formula.
  const safe = /^[=+\-@\t\r\n]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
export function receiptCsv(records: ExportRecord[]): string {
  const columns = [
    "receipt_id",
    "category",
    "amount_base_units",
    "amount_usdc",
    "asset",
    "decimals",
    "network",
    "chain_id",
    "status",
    "evidence_scope",
    "verifier_mode",
    "bounty_id",
    "event_id",
    "event_name",
    "contract",
    "transaction_hash",
    "block_number",
    "block_hash",
    "log_index",
    "recorded_at",
  ];
  const lines = records.map((r) =>
    [
      r.id,
      r.category,
      r.amount,
      formatMoney(BigInt(r.amount)),
      r.asset,
      "6",
      r.chainId === "5042002" ? "Arc Testnet" : "Local test chain",
      r.chainId,
      "FINAL",
      "FIXTURE_ONLY",
      "TRUSTED_SERVICE",
      r.bountyId ?? "",
      r.eventId,
      r.eventName,
      r.contract,
      r.transactionHash,
      r.blockNumber,
      r.blockHash,
      r.logIndex,
      r.recordedAt,
    ]
      .map(cell)
      .join(","),
  );
  return `${[columns.map(cell).join(","), ...lines].join("\r\n")}\r\n`;
}
