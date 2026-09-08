import { erc20Abi, type Hex, type Log, parseEventLogs } from "viem";
import { DomainError } from "../../domain/src/index.ts";
import { ARC_USDC } from "./arc.ts";
export function assertTransferMatches(
  transaction: {
    from: string;
    to: string | null;
    input: Hex;
    value: bigint;
    nonce: number;
    chainId?: number;
  },
  expected: { from: string; data: string; nonce: number },
) {
  if (
    transaction.from.toLowerCase() !== expected.from.toLowerCase() ||
    transaction.to?.toLowerCase() !== ARC_USDC ||
    transaction.input !== expected.data ||
    transaction.value !== 0n ||
    transaction.nonce !== expected.nonce ||
    transaction.chainId !== 5042002
  )
    throw new DomainError(
      "TRANSACTION_MISMATCH",
      "This transaction does not match the approved transfer.",
      400,
    );
}
export function hasExactTransfer(
  logs: Log[],
  expected: { from: string; recipient: string; amount: string },
) {
  return parseEventLogs({
    abi: erc20Abi,
    eventName: "Transfer",
    logs: logs.filter((log) => log.address.toLowerCase() === ARC_USDC),
    strict: true,
  }).some(
    (log) =>
      log.args.from.toLowerCase() === expected.from.toLowerCase() &&
      log.args.to.toLowerCase() === expected.recipient.toLowerCase() &&
      log.args.value === BigInt(expected.amount),
  );
}
