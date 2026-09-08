import { erc20Abi, parseEventLogs } from "viem";
import { z } from "zod";
import { bountyEscrowAbi } from "../packages/chain/src/abi/BountyEscrow.ts";
import { fundingBudgetControllerAbi } from "../packages/chain/src/abi/FundingBudgetController.ts";
import type { FundingReceipt } from "../packages/chain/src/funding.ts";
import { address, bytes32, uint } from "../packages/domain/src/index.ts";

export const expectedEventSchema = z.strictObject({
  name: z.string().min(1),
  contract: address,
  transactionHash: bytes32,
  blockNumber: uint(),
  blockHash: bytes32,
  logIndex: z.number().int().nonnegative().optional(),
  fields: z
    .record(z.string(), z.union([z.string(), z.boolean()]))
    .refine((fields) => Object.keys(fields).length > 0),
});
export type ExpectedEvent = z.infer<typeof expectedEventSchema>;
export function verifyLiveEvent(expected: ExpectedEvent, receipt: FundingReceipt) {
  const fail = () => new Error("The event differs from its saved evidence.");
  if (
    receipt.status !== "success" ||
    receipt.hash !== expected.transactionHash ||
    receipt.blockHash !== expected.blockHash ||
    String(receipt.blockNumber) !== expected.blockNumber
  )
    throw fail();
  const logs = receipt.logs.filter(
    (log) =>
      log.address.toLowerCase() === expected.contract &&
      (expected.logIndex === undefined || log.logIndex === expected.logIndex),
  );
  if (
    logs.some(
      (log) =>
        log.removed ||
        log.blockHash !== receipt.blockHash ||
        log.blockNumber !== receipt.blockNumber ||
        log.transactionHash !== receipt.hash,
    )
  )
    throw fail();
  const matched = parseEventLogs({
    abi: [...bountyEscrowAbi, ...fundingBudgetControllerAbi, ...erc20Abi],
    logs,
    strict: true,
  }).filter((event) => {
    if (event.eventName !== expected.name) return false;
    const fields = Object.fromEntries(
      Object.entries(event.args).map(([key, value]) => [
        key,
        typeof value === "bigint"
          ? String(value)
          : typeof value === "string"
            ? value.toLowerCase()
            : value,
      ]),
    );
    return Object.entries(expected.fields).every(([key, value]) => fields[key] === value);
  });
  if (matched.length !== 1) throw fail();
}
