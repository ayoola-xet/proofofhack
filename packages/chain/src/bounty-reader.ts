import { createPublicClient, type Hex, http, TransactionReceiptNotFoundError } from "viem";
import { type BountyPolicy, DomainError, hashPolicy } from "../../domain/src/index.ts";
import { bountyEscrowAbi } from "./abi/BountyEscrow.ts";
import type { FundingReceipt } from "./funding.ts";
export type BountySnapshot = {
  state: number;
  timestamp: bigint;
  blockNumber: bigint;
  blockHash: Hex;
  policyHash: Hex;
  reportHash: Hex;
  unallocatedReward: bigint;
  claimantCredit: bigint;
  reservation: {
    claimId: Hex;
    claimant: Hex;
    evidenceCommitment: Hex;
    reservedAt: bigint;
    expiresAt: bigint;
  };
};
export interface BountyReader {
  read(policy: BountyPolicy): Promise<BountySnapshot>;
}
export class ReadOnlyBountyChain implements BountyReader {
  private client;
  constructor(
    rpc: string,
    private chainId: number,
    private escrow: Hex,
  ) {
    const url = new URL(rpc);
    if (
      url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname))
    )
      throw new Error("Use a configured HTTPS or local test RPC.");
    this.client = createPublicClient({ transport: http(rpc, { timeout: 15000, retryCount: 1 }) });
  }
  async read(policy: BountyPolicy): Promise<BountySnapshot> {
    if (
      policy.escrow !== this.escrow.toLowerCase() ||
      Number(policy.settlementChainId) !== this.chainId ||
      (await this.client.getChainId()) !== this.chainId
    )
      throw new DomainError(
        "CHAIN_SCOPE",
        "The bounty does not match the configured settlement chain.",
      );
    const block = await this.client.getBlock({ blockTag: "finalized" });
    const state = await this.client.readContract({
      address: this.escrow,
      abi: bountyEscrowAbi,
      functionName: "getBounty",
      args: [hashPolicy(policy)],
      blockNumber: block.number,
    });
    if (state.state === 0)
      throw new DomainError("BOUNTY_NOT_FUNDED", "The bounty has no final funding record.");
    const actual = Object.fromEntries(
      Object.entries(state.policy).map(([key, value]) => [
        key,
        typeof value === "bigint" || typeof value === "number" ? String(value) : value,
      ]),
    );
    if (hashPolicy(actual) !== hashPolicy(policy))
      throw new DomainError(
        "CHAIN_POLICY_MISMATCH",
        "The final chain policy does not match the saved bounty.",
      );
    return {
      state: state.state,
      timestamp: block.timestamp,
      blockNumber: block.number,
      blockHash: block.hash,
      policyHash: hashPolicy(policy),
      reportHash: state.reportHash,
      unallocatedReward: state.unallocatedReward,
      claimantCredit: state.claimantCredit,
      reservation: state.reservation,
    };
  }
  async finalReceipt(hash: Hex): Promise<FundingReceipt | null> {
    let receipt: Awaited<ReturnType<typeof this.client.getTransactionReceipt>>;
    try {
      receipt = await this.client.getTransactionReceipt({ hash });
    } catch (error) {
      if (error instanceof TransactionReceiptNotFoundError) return null;
      throw error;
    }
    const [block, head] = await Promise.all([
      this.client.getBlock({ blockNumber: receipt.blockNumber }),
      this.client.getBlock({ blockTag: "finalized" }),
    ]);
    if (
      receipt.transactionHash !== hash ||
      block.hash !== receipt.blockHash ||
      head.number < receipt.blockNumber
    )
      return null;
    return {
      hash,
      blockHash: receipt.blockHash,
      blockNumber: receipt.blockNumber,
      status: receipt.status,
      logs: receipt.logs,
    };
  }
}
