import {
  erc20Abi,
  type Hex,
  type Log,
  parseEventLogs,
  TransactionReceiptNotFoundError,
  toHex,
} from "viem";
import { type BountyPolicy, DomainError, hashPolicy } from "../../domain/src/index.ts";
import type { TreasuryTransaction } from "../../privy/src/treasury.ts";
import { bountyEscrowAbi } from "./abi/BountyEscrow.ts";
import { ARC_USDC, arcClient } from "./arc.ts";
import { hasExactTransfer } from "./transfers.ts";

export type FundingReceipt = {
  hash: Hex;
  blockNumber: bigint;
  blockHash: Hex;
  status: "success" | "reverted";
  logs: Log[];
};
export interface FundingChain {
  balance(wallet: Hex): Promise<bigint>;
  prepare(wallet: Hex, to: Hex, data: Hex): Promise<TreasuryTransaction>;
  broadcast(serialized: Hex): Promise<Hex>;
  finalReceipt(hash: Hex): Promise<FundingReceipt | null>;
}
export class ArcFundingChain implements FundingChain {
  private client = arcClient();
  async balance(wallet: Hex) {
    return this.client.readContract({
      address: ARC_USDC,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [wallet],
    });
  }
  async prepare(wallet: Hex, to: Hex, data: Hex) {
    const [nonce, gasEstimate, price] = await Promise.all([
      this.client.getTransactionCount({ address: wallet, blockTag: "pending" }),
      this.client.estimateGas({ account: wallet, to, data, value: 0n }),
      this.client.getGasPrice(),
    ]);
    const gasLimit = (gasEstimate * 12n) / 10n + 1000n,
      gasPrice = (price * 12n) / 10n + 1n;
    if (gasLimit * gasPrice > 50000000000000000n)
      throw new DomainError(
        "FEE_CAP",
        "The estimated network fee exceeds the approved 0.05 test USDC cap.",
      );
    return { to, data, nonce, gasLimit: toHex(gasLimit), gasPrice: toHex(gasPrice) };
  }
  async broadcast(serialized: Hex) {
    return this.client.sendRawTransaction({ serializedTransaction: serialized });
  }
  async finalReceipt(hash: Hex): Promise<FundingReceipt | null> {
    let receipt: Awaited<ReturnType<typeof this.client.getTransactionReceipt>>;
    try {
      receipt = await this.client.getTransactionReceipt({ hash });
    } catch (error) {
      if (error instanceof TransactionReceiptNotFoundError) return null;
      throw error;
    }
    const [block, finalized] = await Promise.all([
      this.client.getBlock({ blockNumber: receipt.blockNumber }),
      this.client.getBlock({ blockTag: "finalized" }),
    ]);
    if (
      receipt.transactionHash !== hash ||
      block.hash !== receipt.blockHash ||
      finalized.number < receipt.blockNumber
    )
      return null;
    return {
      hash,
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
      status: receipt.status,
      logs: receipt.logs,
    };
  }
}
export function exactApproval(receipt: FundingReceipt, wallet: Hex, escrow: Hex, amount: string) {
  return parseEventLogs({
    abi: erc20Abi,
    eventName: "Approval",
    logs: receipt.logs.filter((log) => log.address.toLowerCase() === ARC_USDC),
    strict: true,
  }).some(
    (log) =>
      log.args.owner.toLowerCase() === wallet.toLowerCase() &&
      log.args.spender.toLowerCase() === escrow.toLowerCase() &&
      log.args.value === BigInt(amount),
  );
}
export function exactBountyFunding(receipt: FundingReceipt, wallet: Hex, policy: BountyPolicy) {
  const hash = hashPolicy(policy);
  const events = parseEventLogs({
    abi: bountyEscrowAbi,
    eventName: "BountyFunded",
    logs: receipt.logs.filter((log) => log.address.toLowerCase() === policy.escrow),
    strict: true,
  }).filter(
    (log) =>
      log.args.bountyId === hash &&
      log.args.policyHash === hash &&
      log.args.organizationId === policy.organizationId &&
      log.args.reward === BigInt(policy.reward) &&
      log.args.asset.toLowerCase() === policy.asset,
  );
  if (
    events.length !== 1 ||
    !hasExactTransfer(receipt.logs, {
      from: wallet,
      recipient: policy.escrow,
      amount: policy.reward,
    })
  )
    throw new DomainError(
      "FUNDING_EVENT_MISMATCH",
      "The final transaction does not prove the approved bounty funding.",
    );
  return events[0];
}
