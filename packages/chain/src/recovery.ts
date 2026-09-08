import { erc20Abi, type Hex, parseEventLogs } from "viem";
import { type BountyPolicy, DomainError, hashPolicy } from "../../domain/src/index.ts";
import { bountyEscrowAbi } from "./abi/BountyEscrow.ts";
import type { BountyReader } from "./bounty-reader.ts";
import type { FundingReceipt } from "./funding.ts";

export type RecoveryChain = BountyReader & {
  finalReceipt(hash: Hex): Promise<FundingReceipt | null>;
};

export function recoveryEvents(receipt: FundingReceipt, policy: BountyPolicy) {
  const mismatch = () =>
    new DomainError("RECOVERY_EVENT_MISMATCH", "The receipt does not prove this bounty recovery.");
  if (receipt.status !== "success") throw mismatch();
  const indexes = new Set<number>();
  for (const log of receipt.logs) {
    if (
      log.removed ||
      log.transactionHash !== receipt.hash ||
      log.blockHash !== receipt.blockHash ||
      log.blockNumber !== receipt.blockNumber ||
      log.logIndex === null ||
      indexes.has(log.logIndex)
    )
      throw mismatch();
    indexes.add(log.logIndex);
  }
  const events = parseEventLogs({
    abi: bountyEscrowAbi,
    eventName: ["ReservationExpired", "BountyRefunded"],
    logs: receipt.logs.filter((log) => log.address.toLowerCase() === policy.escrow),
    strict: true,
  }).filter((event) => event.args.bountyId === hashPolicy(policy));
  if (
    !events.length ||
    events.length > 2 ||
    new Set(events.map((e) => e.eventName)).size !== events.length
  )
    throw mismatch();
  for (const event of events) {
    if (event.eventName !== "BountyRefunded") continue;
    const transfers = parseEventLogs({
      abi: erc20Abi,
      eventName: "Transfer",
      logs: receipt.logs.filter((log) => log.address.toLowerCase() === policy.asset),
      strict: true,
    }).filter(
      (log) =>
        log.args.from.toLowerCase() === policy.escrow &&
        log.args.to.toLowerCase() === policy.refundRecipient &&
        log.args.value === BigInt(policy.reward),
    );
    if (
      event.args.refundRecipient.toLowerCase() !== policy.refundRecipient ||
      event.args.asset.toLowerCase() !== policy.asset ||
      event.args.amount !== BigInt(policy.reward) ||
      transfers.length !== 1
    )
      throw mismatch();
  }
  const sorted = events.sort((a, b) => (a.logIndex ?? -1) - (b.logIndex ?? -1));
  if (sorted.length === 2 && sorted[0].eventName !== "ReservationExpired") throw mismatch();
  return sorted;
}
