import { z } from "zod";
import { ARC_USDC } from "../../../packages/chain/src/arc.ts";
import { address } from "../../../packages/domain/src/index.ts";

export const receiptScopeSchema = z.discriminatedUnion("chainId", [
  z.strictObject({ chainId: z.literal("5042002"), asset: z.literal(ARC_USDC) }),
  z.strictObject({ chainId: z.literal("31337"), asset: address }),
]);
export type ReceiptScope = z.infer<typeof receiptScopeSchema>;
export const arcReceiptScope: ReceiptScope = { chainId: "5042002", asset: ARC_USDC };

export function configuredReceiptScope(
  environment: "local" | "arc-testnet",
  localAsset?: string,
): ReceiptScope {
  if (localAsset === undefined) return arcReceiptScope;
  if (environment !== "local") throw new Error("Local receipt assets require a local environment.");
  return receiptScopeSchema.parse({ chainId: "31337", asset: localAsset });
}
