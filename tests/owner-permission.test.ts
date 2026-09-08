import { decodeFunctionData } from "viem";
import { beforeEach, expect, it, vi } from "vitest";
import { type OwnerCommand, ownerCall } from "../packages/chain/src/owner-command.ts";
import { ownerPermissionRules } from "../packages/privy/src/owner-permission.ts";
import {
  canonicalTreasuryRules,
  PrivyTreasury,
  treasuryRules,
} from "../packages/privy/src/treasury.ts";
import { a, h } from "./helpers/policy.ts";

const mock = vi.hoisted(() => ({
  getWallet: vi.fn(),
  getPolicy: vi.fn(),
  getOwner: vi.fn(),
  update: vi.fn(),
}));
vi.mock("@privy-io/node", () => ({
  PrivyClient: class {
    wallets() {
      return { get: mock.getWallet };
    }
    policies() {
      return { get: mock.getPolicy, update: mock.update };
    }
    keyQuorums() {
      return { get: mock.getOwner };
    }
  },
}));
const config = { organizationId: h(1), escrow: a(1), maxPerAction: "5000000" },
  wallet = { id: "wallet", address: a(2), ownerId: "owner", policyIds: ["policy"] };
const provider = new PrivyTreasury("test-app", "test-secret", {
  publicKey: "test-public",
  privateKey: "test-private",
});
let rules = treasuryRules(config);
const permission = () => ({
  controller: a(3),
  command: { kind: "SET_ENABLED" as const, enabled: false },
  expiresAt: new Date(Date.now() + 600000).toISOString(),
});
beforeEach(() => {
  vi.clearAllMocks();
  rules = treasuryRules(config);
  mock.getWallet.mockImplementation(async () => ({
    address: wallet.address,
    chain_type: "ethereum",
    owner_id: wallet.ownerId,
    policy_ids: wallet.policyIds,
    additional_signers: [],
  }));
  mock.getOwner.mockImplementation(async () => ({
    authorization_threshold: 1,
    authorization_keys: [{ public_key: "test-public" }],
    user_ids: [],
    key_quorum_ids: [],
  }));
  mock.getPolicy.mockImplementation(async () => ({
    owner_id: wallet.ownerId,
    chain_type: "ethereum",
    version: "1.0",
    rules,
  }));
  mock.update.mockImplementation(async (_id, input) => {
    rules = input.rules;
  });
});
it("recovers a lost policy update response and restores only the known base policy", async () => {
  const p = permission();
  mock.update.mockImplementationOnce(async (_id, input) => {
    rules = input.rules;
    throw new Error("Update response lost");
  });
  await expect(provider.setOwnerPermission(wallet, config, p)).rejects.toThrow(
    "Update response lost",
  );
  await provider.setOwnerPermission(wallet, config, p);
  expect(mock.update).toHaveBeenCalledTimes(1);
  await provider.restoreOwnerPermission(wallet, config, p);
  await provider.restoreOwnerPermission(wallet, config, p);
  expect(mock.update).toHaveBeenCalledTimes(2);
  expect(canonicalTreasuryRules(rules)).toBe(canonicalTreasuryRules(treasuryRules(config)));
});
it("refuses an unexpected wallet rule or signer instead of replacing its controls", async () => {
  rules = [
    ...treasuryRules(config),
    { name: "Unexpected rule", method: "personal_sign", action: "ALLOW", conditions: [] },
  ];
  await expect(provider.setOwnerPermission(wallet, config, permission())).rejects.toMatchObject({
    code: "PROVIDER_POLICY_MISMATCH",
  });
  await expect(provider.restoreOwnerPermission(wallet, config, permission())).rejects.toMatchObject(
    { code: "PROVIDER_POLICY_MISMATCH" },
  );
  expect(mock.update).not.toHaveBeenCalled();
  rules = treasuryRules(config);
  mock.getWallet.mockImplementationOnce(async () => ({
    address: wallet.address,
    chain_type: "ethereum",
    owner_id: wallet.ownerId,
    policy_ids: wallet.policyIds,
    additional_signers: ["unknown"],
  }));
  mock.getOwner.mockImplementation(async () => ({
    authorization_threshold: 1,
    authorization_keys: [{ public_key: "different" }],
  }));
  await expect(provider.setOwnerPermission(wallet, config, permission())).rejects.toMatchObject({
    code: "PROVIDER_POLICY_MISMATCH",
  });
  expect(mock.update).not.toHaveBeenCalled();
});
it("binds each rule to the contract ABI and records the Boolean control boundary", () => {
  const commands: OwnerCommand[] = [
    { kind: "SET_LIMITS", perAction: "1000000", daily: "3000000", interval: 60 },
    { kind: "SET_ENABLED", enabled: false },
    {
      kind: "APPROVE_POLICY",
      draftId: "00000000-0000-4000-8000-000000000001",
      policyHash: h(10),
      reward: "1000000",
      expiresAt: "1800000000",
    },
    { kind: "DEPOSIT", amount: "1000000" },
    { kind: "WITHDRAW", amount: "1000000" },
  ];
  for (const command of commands) {
    const p = { ...permission(), command },
      rules = ownerPermissionRules(config, p),
      added = rules.at(-1);
    expect(rules.slice(0, -1)).toEqual(treasuryRules(config));
    expect(added?.method).toBe("eth_signTransaction");
    expect(added?.conditions).toContainEqual({
      field_source: "system",
      field: "current_unix_timestamp",
      operator: "lt",
      value: String(Math.floor(Date.parse(p.expiresAt) / 1000)),
    });
    expect(added?.conditions).toContainEqual({
      field_source: "ethereum_transaction",
      field: "chain_id",
      operator: "eq",
      value: "5042002",
    });
    expect(
      added?.conditions.filter(
        (c) => c.field_source === "ethereum_calldata" && c.field !== "function_name",
      ),
    ).toHaveLength(
      command.kind === "SET_ENABLED"
        ? 0
        : command.kind === "SET_LIMITS" || command.kind === "APPROVE_POLICY"
          ? 3
          : command.kind === "DEPOSIT"
            ? 2
            : 1,
    );
    expect(
      added?.conditions.every((c) => c.field_source !== "ethereum_calldata" || c.operator === "eq"),
    ).toBe(true);
    const call = ownerCall(p.controller, command),
      decoded = decodeFunctionData({ abi: call.abi, data: call.data }),
      fn = call.abi.find(
        (entry) => entry.type === "function" && entry.name === decoded.functionName,
      );
    if (fn?.type !== "function") throw new Error("Missing function ABI");
    if (command.kind !== "SET_ENABLED") {
      for (const [index, arg] of fn.inputs.entries()) {
        expect(added?.conditions).toContainEqual({
          field_source: "ethereum_calldata",
          field: `${fn.name}.${arg.name}`,
          operator: "eq",
          value: String(decoded.args?.[index]),
          abi: [fn],
        });
      }
    } else {
      expect(added?.conditions).toContainEqual({
        field_source: "ethereum_transaction",
        field: "to",
        operator: "eq",
        value: p.controller,
      });
      expect(added?.conditions).toContainEqual({
        field_source: "ethereum_calldata",
        field: "function_name",
        operator: "eq",
        value: "setEnabled",
        abi: [fn],
      });
    }
  }
});
it("does not grant an expired permission but can remove it", async () => {
  const p = { ...permission(), expiresAt: new Date(Date.now() - 1000).toISOString() };
  rules = ownerPermissionRules(config, p);
  await expect(provider.setOwnerPermission(wallet, config, p)).rejects.toThrow("expired");
  expect(mock.update).not.toHaveBeenCalled();
  await provider.restoreOwnerPermission(wallet, config, p);
  expect(canonicalTreasuryRules(rules)).toBe(canonicalTreasuryRules(treasuryRules(config)));
});
