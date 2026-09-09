import { canonicalJson } from "../../crypto-envelope/src/index.ts";
import { type BountyPolicy, formatMoney } from "../../domain/src/index.ts";

export function fundingAuthorizationMessage(input: {
  requestId: string;
  actorId: string;
  walletAddress: string;
  policyHash: string;
  policy: BountyPolicy;
  expiresAt: string;
}) {
  return [
    "ProofOfHack bounty funding authorization v1",
    `Network: Arc Testnet (5042002)`,
    `Reward: ${formatMoney(BigInt(input.policy.reward))} test USDC`,
    `Funding wallet: ${input.walletAddress}`,
    `Refund recipient: ${input.policy.refundRecipient}`,
    `Escrow: ${input.policy.escrow}`,
    `Source vault: ${input.policy.sourceVault}`,
    `Submission deadline: ${input.policy.submissionDeadline}`,
    `Policy hash: ${input.policyHash}`,
    "Authorize one token approval and one escrow funding transaction.",
    "Maximum network fee: 0.05 test USDC for each transaction.",
    "This authorization uses synthetic fixture evidence.",
    canonicalJson({ ...input, version: "1" }),
  ].join("\n");
}
