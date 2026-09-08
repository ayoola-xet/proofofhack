import { expect, it, vi } from "vitest";
import { ArcFundingChain } from "../packages/chain/src/funding.ts";
import { h } from "./helpers/policy.ts";

const { getTransactionReceipt, getBlock } = vi.hoisted(() => ({
  getTransactionReceipt: vi.fn(),
  getBlock: vi.fn(),
}));
vi.mock("../packages/chain/src/arc.ts", () => ({
  ARC_USDC: "0x3600000000000000000000000000000000000000",
  arcClient: () => ({ getTransactionReceipt, getBlock }),
}));
it("Requires a canonical block and a finalized head before accepting the receipt", async () => {
  const chain = new ArcFundingChain();
  getTransactionReceipt.mockResolvedValue({
    transactionHash: h(1),
    blockNumber: 10n,
    blockHash: h(2),
    status: "success",
    logs: [],
  });
  getBlock.mockImplementation(async (arg) =>
    arg.blockTag ? { number: 9n, hash: h(3) } : { number: 10n, hash: h(2) },
  );
  expect(await chain.finalReceipt(h(1))).toBeNull();
  getBlock.mockImplementation(async (arg) =>
    arg.blockTag ? { number: 11n, hash: h(3) } : { number: 10n, hash: h(99) },
  );
  expect(await chain.finalReceipt(h(1))).toBeNull();
  getBlock.mockImplementation(async (arg) =>
    arg.blockTag ? { number: 11n, hash: h(3) } : { number: 10n, hash: h(2) },
  );
  expect(await chain.finalReceipt(h(1))).toMatchObject({
    hash: h(1),
    blockHash: h(2),
    blockNumber: 10n,
    status: "success",
  });
});
it("Preserves provider errors instead of treating them as missing transactions", async () => {
  getTransactionReceipt.mockRejectedValueOnce(new Error("RPC unavailable"));
  await expect(new ArcFundingChain().finalReceipt(h(1))).rejects.toThrow("RPC unavailable");
});
