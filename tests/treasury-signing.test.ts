import { randomBytes, randomUUID } from "node:crypto";
import { encodeFunctionData, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { expect, it, vi } from "vitest";
import { ARC_USDC } from "../packages/chain/src/arc.ts";
import { approvalAbi, PrivyTreasury } from "../packages/privy/src/treasury.ts";

const { signTransaction } = vi.hoisted(() => ({ signTransaction: vi.fn() }));
vi.mock("@privy-io/node", () => ({
  PrivyClient: class {
    wallets() {
      return { ethereum: () => ({ signTransaction }) };
    }
  },
}));
const account = privateKeyToAccount(`0x${randomBytes(32).toString("hex")}` as Hex);
const wallet = {
  id: "test-wallet",
  address: account.address,
  ownerId: "test-owner",
  policyIds: ["test-policy"],
};
const provider = new PrivyTreasury("test-app", "test-secret", {
  publicKey: "test",
  privateKey: "test",
});
const input = {
  to: ARC_USDC,
  data: encodeFunctionData({
    abi: approvalAbi,
    functionName: "approve",
    args: [account.address, 0n],
  }),
  nonce: 0,
  gasLimit: "0x186a0" as Hex,
  gasPrice: "0x1" as Hex,
};
const unsigned = {
  to: input.to,
  data: input.data,
  nonce: input.nonce,
  gas: 100000n,
  gasPrice: 1n,
  chainId: 5042002,
  type: "legacy" as const,
  value: 0n,
};
it("Checks the signer and full transaction before returning a provider signature", async () => {
  const serialized = await account.signTransaction(unsigned);
  signTransaction.mockResolvedValue({ encoding: "rlp", signed_transaction: serialized });
  expect(await provider.sign(wallet, randomUUID(), input)).toMatchObject({ serialized });
  expect(signTransaction.mock.calls[0][1].params.transaction).toMatchObject({
    chain_id: 5042002,
    type: 0,
    value: "0x0",
    gas_limit: input.gasLimit,
  });
});
it("Rejects a changed network, nonce, value, or fee in the signed response", async () => {
  for (const changed of [
    { chainId: 1 },
    { nonce: 1 },
    { value: 1n },
    { gasPrice: 2n },
    { gas: 200000n },
    { data: "0x" as Hex },
    { to: account.address },
  ]) {
    signTransaction.mockResolvedValue({
      encoding: "rlp",
      signed_transaction: await account.signTransaction({ ...unsigned, ...changed }),
    });
    await expect(provider.sign(wallet, randomUUID(), input)).rejects.toThrow("does not match");
  }
});
it("Rejects a valid signature from a different wallet", async () => {
  const other = privateKeyToAccount(`0x${randomBytes(32).toString("hex")}` as Hex);
  signTransaction.mockResolvedValue({
    encoding: "rlp",
    signed_transaction: await other.signTransaction(unsigned),
  });
  await expect(provider.sign(wallet, randomUUID(), input)).rejects.toThrow("does not match");
});
