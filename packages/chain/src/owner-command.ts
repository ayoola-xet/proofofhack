import { encodeFunctionData, erc20Abi, type Hex } from "viem";
import { z } from "zod";
import { canonicalJson } from "../../crypto-envelope/src/index.ts";
import { bytes32, formatMoney, uint } from "../../domain/src/index.ts";
import { fundingBudgetControllerAbi as abi } from "./abi/FundingBudgetController.ts";
import { ARC_USDC } from "./arc.ts";

const amount = uint().refine(
  (v) => BigInt(v) > 0n && BigInt(v) <= 100000000n,
  "Use an amount from one base unit to 100 test USDC.",
);
export const ownerCommandSchema = z.discriminatedUnion("kind", [
  z
    .strictObject({
      kind: z.literal("SET_LIMITS"),
      perAction: amount,
      daily: amount,
      interval: z.number().int().min(60).max(86400),
    })
    .refine(
      (v) => BigInt(v.daily) >= BigInt(v.perAction),
      "The daily limit must cover one allocation.",
    ),
  z.strictObject({ kind: z.literal("SET_ENABLED"), enabled: z.boolean() }),
  z.strictObject({
    kind: z.literal("APPROVE_POLICY"),
    draftId: z.uuid(),
    policyHash: bytes32,
    reward: amount,
    expiresAt: uint(64),
  }),
  z.strictObject({ kind: z.literal("DEPOSIT"), amount }),
  z.strictObject({ kind: z.literal("WITHDRAW"), amount }),
]);
export type OwnerCommand = z.infer<typeof ownerCommandSchema>;
export function ownerCall(controller: Hex, command: OwnerCommand) {
  const c = ownerCommandSchema.parse(command);
  switch (c.kind) {
    case "SET_LIMITS":
      return {
        to: controller,
        data: encodeFunctionData({
          abi,
          functionName: "setLimits",
          args: [BigInt(c.perAction), BigInt(c.daily), BigInt(c.interval)],
        }),
        functionName: "setLimits",
        fields: { perAction: c.perAction, daily: c.daily, interval: String(c.interval) },
        abi,
      };
    case "SET_ENABLED":
      return {
        to: controller,
        data: encodeFunctionData({ abi, functionName: "setEnabled", args: [c.enabled] }),
        functionName: "setEnabled",
        fields: { value: String(c.enabled) },
        abi,
      };
    case "APPROVE_POLICY":
      return {
        to: controller,
        data: encodeFunctionData({
          abi,
          functionName: "approvePolicy",
          args: [c.policyHash, BigInt(c.reward), BigInt(c.expiresAt)],
        }),
        functionName: "approvePolicy",
        fields: { hash: c.policyHash, reward: c.reward, expiresAt: c.expiresAt },
        abi,
      };
    case "DEPOSIT":
      return {
        to: ARC_USDC,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "transfer",
          args: [controller, BigInt(c.amount)],
        }),
        functionName: "transfer",
        fields: { recipient: controller, amount: c.amount },
        abi: erc20Abi,
      };
    case "WITHDRAW":
      return {
        to: controller,
        data: encodeFunctionData({
          abi,
          functionName: "withdrawUnallocated",
          args: [BigInt(c.amount)],
        }),
        functionName: "withdrawUnallocated",
        fields: { amount: c.amount },
        abi,
      };
  }
}
export function ownerCommandDescription(command: OwnerCommand) {
  switch (command.kind) {
    case "SET_LIMITS":
      return `Set the allocation limit to ${formatMoney(BigInt(command.perAction))} test USDC, the daily limit to ${formatMoney(BigInt(command.daily))} test USDC, and the interval to ${command.interval} seconds.`;
    case "SET_ENABLED":
      return command.enabled
        ? "Enable automatic funding of exact owner-approved policies within the controller limits."
        : "Disable new automatic allocations. Pending transactions can still complete.";
    case "APPROVE_POLICY":
      return `Approve policy ${command.policyHash} for ${formatMoney(BigInt(command.reward))} test USDC until ${new Date(Number(command.expiresAt) * 1000).toISOString()}.`;
    case "DEPOSIT":
      return `Transfer ${formatMoney(BigInt(command.amount))} test USDC from the organization wallet to the controller.`;
    case "WITHDRAW":
      return `Return ${formatMoney(BigInt(command.amount))} test USDC from the controller to its owner wallet.`;
  }
}
export function ownerAuthorizationMessage(input: {
  requestId: string;
  actorId: string;
  controller: Hex;
  wallet: Hex;
  organizationId: Hex;
  command: OwnerCommand;
  expiresAt: string;
}) {
  return [
    "ProofOfHack controller owner authorization v1",
    "Network: Arc Testnet (5042002)",
    ownerCommandDescription(input.command),
    `Controller: ${input.controller}`,
    `Owner wallet: ${input.wallet}`,
    "Authorize one transaction with a maximum network fee of 0.05 test USDC.",
    input.command.kind === "SET_ENABLED"
      ? "Privy restricts the chain, controller, function, and expiry. The application checks the exact enabled state against this signed confirmation."
      : "Privy receives an expiring rule for this exact action.",
    "The worker removes the temporary rule after saving the signed transaction.",
    canonicalJson({
      ...input,
      command:
        input.command.kind === "SET_LIMITS"
          ? { ...input.command, interval: String(input.command.interval) }
          : input.command,
      version: "1",
    }),
  ].join("\n");
}
