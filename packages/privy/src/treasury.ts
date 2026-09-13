import { PrivyClient } from "@privy-io/node";
import {
  encodeFunctionData,
  type Hex,
  keccak256,
  parseAbi,
  parseTransaction,
  recoverTransactionAddress,
  type TransactionSerialized,
} from "viem";
import { z } from "zod";
import { bountyEscrowAbi } from "../../chain/src/abi/BountyEscrow.ts";
import { ARC_USDC } from "../../chain/src/arc.ts";
import { canonicalJson } from "../../crypto-envelope/src/index.ts";
import { address, bytes32, DomainError } from "../../domain/src/index.ts";
import { type OwnerPermission, ownerPermissionRules } from "./owner-permission.ts";

type PolicyInput = Parameters<ReturnType<PrivyClient["policies"]>["create"]>[0];
export type TreasuryConfiguration = { organizationId: Hex; escrow: Hex; maxPerAction: string };
export const approvalAbi = parseAbi([
  "function approve(address spender,uint256 amount) returns (bool)",
]);
export function treasuryRules(
  config: TreasuryConfiguration,
  method: "eth_signTransaction" | "eth_sendTransaction" = "eth_signTransaction",
): PolicyInput["rules"] {
  address.parse(config.escrow);
  bytes32.parse(config.organizationId);
  if (!/^[1-9][0-9]*$/.test(config.maxPerAction) || BigInt(config.maxPerAction) > 100000000n)
    throw new Error("Treasury limits must be from one base unit to 100 test USDC.");
  const common = [
    {
      field_source: "ethereum_transaction" as const,
      field: "chain_id" as const,
      operator: "eq" as const,
      value: "5042002",
    },
    {
      field_source: "ethereum_transaction" as const,
      field: "value" as const,
      operator: "eq" as const,
      value: "0",
    },
  ];
  const approveAbi = JSON.parse(JSON.stringify(approvalAbi));
  const fundAbi = JSON.parse(
    JSON.stringify(
      bountyEscrowAbi.filter((a) => a.type === "function" && a.name === "createAndFund"),
    ),
  );
  return [
    {
      name: "Approve only the Arc escrow within the amount cap",
      method,
      action: "ALLOW",
      conditions: [
        ...common,
        { field_source: "ethereum_transaction", field: "to", operator: "eq", value: ARC_USDC },
        {
          field_source: "ethereum_calldata",
          field: "function_name",
          operator: "eq",
          value: "approve",
          abi: approveAbi,
        },
        {
          field_source: "ethereum_calldata",
          field: "approve.spender",
          operator: "eq",
          value: config.escrow,
          abi: approveAbi,
        },
        {
          field_source: "ethereum_calldata",
          field: "approve.amount",
          operator: "lte",
          value: config.maxPerAction,
          abi: approveAbi,
        },
      ],
    },
    {
      name: "Fund only this organization on the Arc escrow",
      method,
      action: "ALLOW",
      conditions: [
        ...common,
        { field_source: "ethereum_transaction", field: "to", operator: "eq", value: config.escrow },
        {
          field_source: "ethereum_calldata",
          field: "function_name",
          operator: "eq",
          value: "createAndFund",
          abi: fundAbi,
        },
        {
          field_source: "ethereum_calldata",
          field: "createAndFund.policy.organizationId",
          operator: "eq",
          value: config.organizationId,
          abi: fundAbi,
        },
        {
          field_source: "ethereum_calldata",
          field: "createAndFund.policy.asset",
          operator: "eq",
          value: ARC_USDC,
          abi: fundAbi,
        },
        {
          field_source: "ethereum_calldata",
          field: "createAndFund.policy.reward",
          operator: "lte",
          value: config.maxPerAction,
          abi: fundAbi,
        },
      ],
    },
  ];
}
export type TreasuryWallet = { id: string; address: Hex; ownerId: string; policyIds: string[] };
export type TreasuryTransaction = {
  to: Hex;
  data: Hex;
  nonce: number;
  gasLimit: Hex;
  gasPrice: Hex;
};
export function canonicalTreasuryRules(rules: PolicyInput["rules"]) {
  return canonicalJson(
    rules.map((rule) => ({
      name: rule.name,
      method: rule.method,
      action: rule.action,
      conditions: rule.conditions.map((condition) => {
        const isAddress =
          (condition.field_source === "ethereum_transaction" && condition.field === "to") ||
          (condition.field_source === "ethereum_calldata" &&
            ["approve.spender", "createAndFund.policy.asset", "transfer.recipient"].includes(
              condition.field,
            ));
        return isAddress && typeof condition.value === "string"
          ? { ...condition, value: address.parse(condition.value) }
          : condition;
      }),
    })),
  );
}
export interface TreasuryProvider {
  createPolicy(key: string, config: TreasuryConfiguration): Promise<string>;
  createWallet(key: string, policyId: string): Promise<TreasuryWallet>;
  verify(wallet: TreasuryWallet, config: TreasuryConfiguration): Promise<void>;
  configureArcSigning?(wallet: TreasuryWallet, config: TreasuryConfiguration): Promise<void>;
  sign(
    wallet: TreasuryWallet,
    key: string,
    transaction: TreasuryTransaction,
  ): Promise<{ hash: Hex; serialized: Hex }>;
}
export class PrivyTreasury implements TreasuryProvider {
  private client: PrivyClient;
  constructor(
    appId: string,
    appSecret: string,
    private authorization: { publicKey: string; privateKey: string },
  ) {
    this.client = new PrivyClient({ appId, appSecret, timeout: 20000, maxRetries: 0 });
  }
  async createPolicy(key: string, config: TreasuryConfiguration) {
    const policy = await this.client.policies().create({
      idempotency_key: key,
      name: `ProofOfHack Arc Treasury ${key.slice(0, 8)}`,
      version: "1.0",
      chain_type: "ethereum",
      owner: { public_key: this.authorization.publicKey },
      rules: treasuryRules(config),
    });
    return policy.id;
  }
  async createWallet(key: string, policyId: string): Promise<TreasuryWallet> {
    const wallet = await this.client.wallets().create({
      idempotency_key: key,
      external_id: key,
      display_name: `ProofOfHack treasury ${key.slice(0, 8)}`,
      chain_type: "ethereum",
      owner: { public_key: this.authorization.publicKey },
      policy_ids: [policyId],
    });
    if (!wallet.owner_id) throw new Error("The provider wallet has no owner.");
    return {
      id: wallet.id,
      address: address.parse(wallet.address),
      ownerId: wallet.owner_id,
      policyIds: wallet.policy_ids,
    };
  }
  async verify(
    wallet: TreasuryWallet,
    config: TreasuryConfiguration,
    method: "eth_signTransaction" | "eth_sendTransaction" = "eth_signTransaction",
  ) {
    return this.verifyRules(wallet, treasuryRules(config, method));
  }
  private async verifyRules(wallet: TreasuryWallet, rules: PolicyInput["rules"]) {
    const [current, policy, owner] = await Promise.all([
      this.client.wallets().get(wallet.id),
      this.client.policies().get(wallet.policyIds[0]),
      this.client.keyQuorums().get(wallet.ownerId),
    ]);
    const policyOwner = policy.owner_id
      ? await this.client.keyQuorums().get(policy.owner_id)
      : null;
    const expectedOwner = (value: typeof owner | null) =>
      value !== null &&
      value.authorization_threshold === 1 &&
      value.authorization_keys.length === 1 &&
      value.authorization_keys[0].public_key === this.authorization.publicKey &&
      (value.user_ids?.length ?? 0) === 0 &&
      (value.key_quorum_ids?.length ?? 0) === 0;
    if (
      address.parse(current.address) !== address.parse(wallet.address) ||
      current.chain_type !== "ethereum" ||
      policy.chain_type !== "ethereum" ||
      policy.version !== "1.0" ||
      current.owner_id !== wallet.ownerId ||
      current.policy_ids.length !== 1 ||
      current.policy_ids[0] !== wallet.policyIds[0] ||
      current.additional_signers.length !== 0 ||
      canonicalTreasuryRules(policy.rules) !== canonicalTreasuryRules(rules) ||
      !expectedOwner(owner) ||
      !expectedOwner(policyOwner)
    )
      throw new DomainError(
        "PROVIDER_POLICY_MISMATCH",
        "The provider wallet controls do not match the approved configuration.",
        503,
      );
  }
  async setOwnerPermission(
    wallet: TreasuryWallet,
    config: TreasuryConfiguration,
    permission: OwnerPermission,
  ) {
    const rules = ownerPermissionRules(config, permission);
    if (Date.parse(permission.expiresAt) <= Date.now())
      throw new Error("The owner permission has expired.");
    try {
      await this.verifyRules(wallet, rules);
      return;
    } catch {
      await this.verify(wallet, config);
    }
    if (Date.parse(permission.expiresAt) <= Date.now())
      throw new Error("The owner permission has expired.");
    await this.client.policies().update(wallet.policyIds[0], {
      rules,
      authorization_context: { authorization_private_keys: [this.authorization.privateKey] },
    });
    await this.verifyRules(wallet, rules);
  }
  async restoreOwnerPermission(
    wallet: TreasuryWallet,
    config: TreasuryConfiguration,
    permission: OwnerPermission,
  ) {
    try {
      await this.verify(wallet, config);
      return;
    } catch {
      await this.verifyRules(wallet, ownerPermissionRules(config, permission));
    }
    await this.client.policies().update(wallet.policyIds[0], {
      rules: treasuryRules(config),
      authorization_context: { authorization_private_keys: [this.authorization.privateKey] },
    });
    await this.verify(wallet, config);
  }
  async configureArcSigning(wallet: TreasuryWallet, config: TreasuryConfiguration) {
    try {
      await this.verify(wallet, config);
      return;
    } catch {
      await this.verify(wallet, config, "eth_sendTransaction");
    }
    await this.client.policies().update(wallet.policyIds[0], {
      rules: treasuryRules(config),
      authorization_context: { authorization_private_keys: [this.authorization.privateKey] },
    });
    await this.verify(wallet, config);
  }
  async sign(wallet: TreasuryWallet, key: string, transaction: TreasuryTransaction) {
    const result = await this.client
      .wallets()
      .ethereum()
      .signTransaction(wallet.id, {
        idempotency_key: key,
        authorization_context: { authorization_private_keys: [this.authorization.privateKey] },
        params: {
          transaction: {
            to: transaction.to,
            data: transaction.data,
            nonce: transaction.nonce,
            chain_id: 5042002,
            value: "0x0",
            gas_limit: transaction.gasLimit,
            gas_price: transaction.gasPrice,
            type: 0,
          },
        },
      });
    const serialized = z
      .string()
      .regex(/^0x[0-9a-fA-F]+$/)
      .parse(result.signed_transaction) as Hex;
    const signed = parseTransaction(serialized);
    const signer = await recoverTransactionAddress({
      serializedTransaction: serialized as TransactionSerialized,
    });
    if (
      result.encoding !== "rlp" ||
      address.parse(signer) !== address.parse(wallet.address) ||
      signed.chainId !== 5042002 ||
      signed.type !== "legacy" ||
      signed.to?.toLowerCase() !== transaction.to.toLowerCase() ||
      signed.data?.toLowerCase() !== transaction.data.toLowerCase() ||
      (signed.value ?? 0n) !== 0n ||
      signed.nonce !== transaction.nonce ||
      signed.gas !== BigInt(transaction.gasLimit) ||
      signed.gasPrice !== BigInt(transaction.gasPrice)
    )
      throw new Error("The signed transaction does not match the approved request.");
    return { hash: keccak256(serialized), serialized };
  }
  async testBlockedApproval(wallet: TreasuryWallet, recipient: Hex, key: string) {
    return this.sign(wallet, key, {
      to: ARC_USDC,
      data: encodeFunctionData({
        abi: approvalAbi,
        functionName: "approve",
        args: [recipient, 0n],
      }),
      nonce: 0,
      gasLimit: "0x186a0",
      gasPrice: "0x1",
    });
  }
}
