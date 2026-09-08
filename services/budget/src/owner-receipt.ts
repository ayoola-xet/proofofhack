import { erc20Abi, parseEventLogs } from "viem";
import { fundingBudgetControllerAbi as abi } from "../../../packages/chain/src/abi/FundingBudgetController.ts";
import type { ControllerBinding } from "../../../packages/chain/src/budget.ts";
import type { FundingReceipt } from "../../../packages/chain/src/funding.ts";
import type { OwnerCommand } from "../../../packages/chain/src/owner-command.ts";
import { DomainError } from "../../../packages/domain/src/index.ts";

export function ownerReceipt(
  receipt: FundingReceipt,
  binding: ControllerBinding,
  command: OwnerCommand,
) {
  const logs = receipt.logs.filter(
    (l) =>
      !l.removed &&
      l.transactionHash === receipt.hash &&
      l.blockHash === receipt.blockHash &&
      l.blockNumber === receipt.blockNumber,
  );
  const contractLogs = logs.filter((l) => l.address.toLowerCase() === binding.address);
  const transfer = (from: string, to: string, amount: string) =>
    parseEventLogs({
      abi: erc20Abi,
      eventName: "Transfer",
      logs: logs.filter((l) => l.address.toLowerCase() === binding.asset),
      strict: true,
    }).filter(
      (e) =>
        e.args.from.toLowerCase() === from &&
        e.args.to.toLowerCase() === to &&
        e.args.value === BigInt(amount),
    );
  let event:
    | { eventName: string; logIndex: number | null; address: string; args: Record<string, unknown> }
    | undefined;
  switch (command.kind) {
    case "SET_LIMITS":
      event = parseEventLogs({
        abi,
        eventName: "BudgetSettingsChanged",
        logs: contractLogs,
        strict: true,
      }).find(
        (e) =>
          e.args.controller.toLowerCase() === binding.address &&
          e.args.perActionLimit === BigInt(command.perAction) &&
          e.args.dailyLimit === BigInt(command.daily) &&
          e.args.minimumInterval === BigInt(command.interval),
      );
      break;
    case "SET_ENABLED":
      event = parseEventLogs({
        abi,
        eventName: "BudgetSettingsChanged",
        logs: contractLogs,
        strict: true,
      }).find(
        (e) =>
          e.args.controller.toLowerCase() === binding.address && e.args.enabled === command.enabled,
      );
      break;
    case "APPROVE_POLICY":
      event = parseEventLogs({
        abi,
        eventName: "PolicyApproved",
        logs: contractLogs,
        strict: true,
      }).find(
        (e) =>
          e.args.controller.toLowerCase() === binding.address &&
          e.args.policyHash === command.policyHash &&
          e.args.reward === BigInt(command.reward) &&
          e.args.expiresAt === BigInt(command.expiresAt),
      );
      break;
    case "DEPOSIT":
      event = transfer(binding.owner, binding.address, command.amount)[0];
      break;
    case "WITHDRAW":
      if (transfer(binding.address, binding.owner, command.amount).length === 1)
        event = parseEventLogs({
          abi,
          eventName: "BudgetWithdrawn",
          logs: contractLogs,
          strict: true,
        }).find(
          (e) =>
            e.args.controller.toLowerCase() === binding.address &&
            e.args.recipient.toLowerCase() === binding.owner &&
            e.args.amount === BigInt(command.amount),
        );
      break;
  }
  if (receipt.status !== "success" || !event || event.logIndex === null)
    throw new DomainError(
      "OWNER_EVENT_MISMATCH",
      "The final receipt does not prove the exact owner action.",
    );
  return {
    name: event.eventName,
    contract: event.address.toLowerCase(),
    logIndex: event.logIndex,
    payload: Object.fromEntries(
      Object.entries(event.args).map(([k, v]) => [
        k,
        typeof v === "bigint" ? String(v) : typeof v === "string" ? v.toLowerCase() : v,
      ]),
    ),
  };
}
