import { createPublicClient, encodeDeployData, erc20Abi, type Hex, http, keccak256 } from "viem";
import { DomainError } from "../../domain/src/index.ts";
import { fundingBudgetControllerAbi as abi } from "./abi/FundingBudgetController.ts";
import { ReadOnlyBountyChain } from "./bounty-reader.ts";
import bytecode from "./bytecode/FundingBudgetController.json";
import type { FundingReceipt } from "./funding.ts";
export type ControllerBinding = {
  chainId: number;
  address: Hex;
  owner: Hex;
  operator: Hex;
  organizationId: Hex;
  escrow: Hex;
  asset: Hex;
};
export type ControllerSnapshot = {
  blockNumber: bigint;
  blockHash: Hex;
  timestamp: bigint;
  enabled: boolean;
  perActionLimit: bigint;
  dailyLimit: bigint;
  minimumInterval: bigint;
  lastAllocation: bigint;
  spentToday: bigint;
  balance: bigint;
  operatorGasBalance: bigint;
  approval: { reward: bigint; expiresAt: bigint; consumed: boolean };
};
export interface BudgetChain {
  read(binding: ControllerBinding, policyHash: Hex): Promise<ControllerSnapshot>;
  finalReceipt(hash: Hex): Promise<FundingReceipt | null>;
  findAllocation(
    binding: ControllerBinding,
    policyHash: Hex,
    fromBlock: bigint,
  ): Promise<FundingReceipt | null>;
  verifyDeployment(
    binding: ControllerBinding,
    hash: Hex,
  ): Promise<{ blockNumber: string; blockHash: Hex; transactionHash: Hex; runtimeCodeHash: Hex }>;
}
export class ReadOnlyBudgetChain implements BudgetChain {
  private client;
  private finality;
  constructor(
    rpc: string,
    private chainId: number,
    private escrow: Hex,
  ) {
    this.finality = new ReadOnlyBountyChain(rpc, chainId, escrow);
    this.client = createPublicClient({ transport: http(rpc, { timeout: 15000, retryCount: 1 }) });
  }
  finalReceipt(hash: Hex) {
    return this.finality.finalReceipt(hash);
  }
  async findAllocation(binding: ControllerBinding, policyHash: Hex, fromBlock: bigint) {
    const state = await this.read(binding, policyHash);
    if (!state.approval.consumed) return null;
    if (fromBlock < 0n || state.blockNumber - fromBlock > 64000n)
      throw new DomainError(
        "RECONCILIATION_REQUIRED",
        "The allocation search needs an operator checkpoint.",
        503,
      );
    for (let start = fromBlock; start <= state.blockNumber; start += 2000n) {
      const toBlock = start + 1999n < state.blockNumber ? start + 1999n : state.blockNumber;
      const logs = await this.client.getContractEvents({
        address: binding.address,
        abi,
        eventName: "BudgetAllocated",
        args: { controller: binding.address, policyHash },
        fromBlock: start,
        toBlock,
        strict: true,
      });
      if (logs.length > 1) throw new Error("Multiple allocation events need review.");
      if (logs[0]) return this.finalReceipt(logs[0].transactionHash);
    }
    throw new DomainError(
      "ALLOCATION_NOT_INDEXED",
      "The consumed approval has no matching final allocation receipt yet.",
      503,
    );
  }
  async verifyDeployment(binding: ControllerBinding, hash: Hex) {
    const final = await this.finalReceipt(hash);
    if (final?.status !== "success")
      throw new DomainError("DEPLOYMENT_NOT_FINAL", "The controller deployment is not final.", 503);
    const [transaction, receipt, code] = await Promise.all([
      this.client.getTransaction({ hash }),
      this.client.getTransactionReceipt({ hash }),
      this.client.getCode({ address: binding.address, blockNumber: final.blockNumber }),
    ]);
    const expected = encodeDeployData({
      abi,
      bytecode: bytecode.creationBytecode as Hex,
      args: [binding.owner, binding.operator, binding.organizationId, binding.escrow],
    });
    if (
      transaction.to !== null ||
      transaction.input.toLowerCase() !== expected.toLowerCase() ||
      receipt.contractAddress?.toLowerCase() !== binding.address.toLowerCase() ||
      !code ||
      code === "0x"
    )
      throw new DomainError(
        "CONTROLLER_CODE_MISMATCH",
        "The deployment does not match the approved controller code and constructor.",
      );
    await this.read(binding, `0x${"0".repeat(64)}`);
    return {
      blockNumber: final.blockNumber.toString(),
      blockHash: final.blockHash,
      transactionHash: hash,
      runtimeCodeHash: keccak256(code),
    };
  }
  async read(binding: ControllerBinding, policyHash: Hex): Promise<ControllerSnapshot> {
    if (
      binding.chainId !== this.chainId ||
      binding.escrow.toLowerCase() !== this.escrow.toLowerCase() ||
      (await this.client.getChainId()) !== this.chainId
    )
      throw new DomainError(
        "CHAIN_SCOPE",
        "The controller does not match the configured settlement chain.",
      );
    const block = await this.client.getBlock({ blockTag: "finalized" });
    const get = <
      N extends
        | "owner"
        | "operator"
        | "organizationId"
        | "asset"
        | "escrow"
        | "enabled"
        | "perActionLimit"
        | "dailyLimit"
        | "minimumInterval"
        | "lastAllocation",
    >(
      functionName: N,
    ) =>
      this.client.readContract({
        address: binding.address,
        abi,
        functionName,
        blockNumber: block.number,
      });
    const [
      owner,
      operator,
      organizationId,
      asset,
      escrow,
      enabled,
      perActionLimit,
      dailyLimit,
      minimumInterval,
      lastAllocation,
      spentToday,
      approval,
      balance,
      operatorGasBalance,
    ] = await Promise.all([
      get("owner"),
      get("operator"),
      get("organizationId"),
      get("asset"),
      get("escrow"),
      get("enabled"),
      get("perActionLimit"),
      get("dailyLimit"),
      get("minimumInterval"),
      get("lastAllocation"),
      this.client.readContract({
        address: binding.address,
        abi,
        functionName: "spentPerDay",
        args: [block.timestamp / 86400n],
        blockNumber: block.number,
      }),
      this.client.readContract({
        address: binding.address,
        abi,
        functionName: "approvals",
        args: [policyHash],
        blockNumber: block.number,
      }),
      this.client.readContract({
        address: binding.asset,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [binding.address],
        blockNumber: block.number,
      }),
      this.client.getBalance({ address: binding.operator, blockNumber: block.number }),
    ]);
    if (
      String(owner).toLowerCase() !== binding.owner.toLowerCase() ||
      String(operator).toLowerCase() !== binding.operator.toLowerCase() ||
      organizationId !== binding.organizationId ||
      String(asset).toLowerCase() !== binding.asset.toLowerCase() ||
      String(escrow).toLowerCase() !== binding.escrow.toLowerCase()
    )
      throw new DomainError(
        "CONTROLLER_BINDING_MISMATCH",
        "The controller owner, operator, organization, asset, or escrow differs.",
      );
    return {
      blockNumber: block.number,
      blockHash: block.hash,
      timestamp: block.timestamp,
      enabled: enabled as boolean,
      perActionLimit: perActionLimit as bigint,
      dailyLimit: dailyLimit as bigint,
      minimumInterval: minimumInterval as bigint,
      lastAllocation: lastAllocation as bigint,
      spentToday,
      balance,
      operatorGasBalance,
      approval: { reward: approval[0], expiresAt: approval[1], consumed: approval[2] },
    };
  }
}
