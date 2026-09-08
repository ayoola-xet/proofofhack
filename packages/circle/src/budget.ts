import { type Hex, toFunctionSignature } from "viem";
import { z } from "zod";
import { fundingBudgetControllerAbi } from "../../chain/src/abi/FundingBudgetController.ts";
import type { ControllerBinding } from "../../chain/src/budget.ts";
import {
  address,
  type BountyPolicy,
  bytes32,
  DomainError,
  hashPolicy,
  policySchema,
} from "../../domain/src/index.ts";
import { type CircleRunner, runCircle } from "./claims.ts";
export interface BudgetExecutor {
  walletId: string;
  send(
    key: string,
    binding: ControllerBinding,
    policy: BountyPolicy,
    requestId: string,
  ): Promise<{ hash: Hex; providerId: string }>;
}
export function budgetArguments(input: BountyPolicy) {
  const policy = policySchema.parse(input),
    entry = fundingBudgetControllerAbi.find(
      (e) => e.type === "function" && e.name === "fundApprovedPolicy",
    );
  if (entry?.type !== "function" || !("components" in entry.inputs[0]))
    throw new Error("The controller ABI is missing.");
  return [
    toFunctionSignature(entry),
    JSON.stringify(
      entry.inputs[0].components.map((field) => policy[field.name as keyof BountyPolicy]),
    ),
  ];
}
export class CircleBudgetExecutor implements BudgetExecutor {
  constructor(
    public walletId: string,
    private operator: Hex,
    private escrow: Hex,
    private run: CircleRunner = runCircle,
  ) {
    z.uuid().parse(walletId);
    address.parse(operator);
    address.parse(escrow);
  }
  async send(key: string, binding: ControllerBinding, input: BountyPolicy, requestId: string) {
    const policy = policySchema.parse(input);
    if (
      binding.chainId !== 5042002 ||
      policy.settlementChainId !== "5042002" ||
      binding.operator !== this.operator ||
      binding.escrow !== this.escrow ||
      policy.escrow !== this.escrow ||
      policy.refundRecipient !== binding.address ||
      policy.organizationId !== binding.organizationId ||
      policy.asset !== binding.asset ||
      key !== `allocation:${binding.address}:${hashPolicy(policy)}`
    )
      throw new DomainError(
        "ALLOCATION_SCOPE",
        "The allocation differs from the approved controller policy.",
      );
    const idempotencyKey = z.uuid({ version: "v4" }).parse(requestId);
    const result = z
      .object({
        id: z.string().min(1),
        idempotencyKey: z.string(),
        txHash: bytes32,
        blockchain: z.literal("ARC-TESTNET"),
        sourceAddress: address,
        contractAddress: address.optional(),
        destinationAddress: address.optional(),
      })
      .parse(
        await this.run([
          "wallet",
          "execute",
          ...budgetArguments(policy),
          "--contract",
          binding.address,
          "--address",
          this.operator,
          "--chain",
          "ARC-TESTNET",
          "--amount",
          "0",
          "--idempotency-key",
          idempotencyKey,
        ]),
      );
    if (
      result.idempotencyKey !== idempotencyKey ||
      result.sourceAddress !== this.operator ||
      (result.contractAddress ?? result.destinationAddress) !== binding.address
    )
      throw new DomainError(
        "CIRCLE_RESPONSE_MISMATCH",
        "The Circle allocation response does not match the saved request.",
        503,
      );
    return { hash: result.txHash, providerId: result.id };
  }
}
