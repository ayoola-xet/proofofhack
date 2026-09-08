import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  erc20Abi,
  type Log,
} from "viem";
import { describe, expect, it } from "vitest";
import { ARC_USDC } from "../packages/chain/src/arc.ts";
import { assertTransferMatches, hasExactTransfer } from "../packages/chain/src/transfers.ts";

const from = "0x0000000000000000000000000000000000000001",
  to = "0x0000000000000000000000000000000000000002";
const data = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, 10000n] });
const expected = { from, recipient: to, amount: "10000", data, nonce: 7 };
const transaction = { from, to: ARC_USDC, input: data, value: 0n, nonce: 7, chainId: 5042002 };
describe("User transfer confirmation", () => {
  it("Matches the saved recipient, amount, sender, chain, and nonce", () => {
    expect(() => assertTransferMatches(transaction, expected)).not.toThrow();
    for (const changed of [
      { from: to },
      { to: from },
      {
        input: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, 10001n] }),
      },
      { value: 1n },
      { nonce: 8 },
      { chainId: 1 },
    ])
      expect(() => assertTransferMatches({ ...transaction, ...changed }, expected)).toThrow();
  });
  it("Requires the exact USDC event, not only a successful transaction", () => {
    const log = {
      blockHash: null,
      blockNumber: null,
      logIndex: null,
      transactionHash: null,
      transactionIndex: null,
      removed: false,
      address: ARC_USDC,
      data: encodeAbiParameters([{ type: "uint256" }], [10000n]),
      topics: encodeEventTopics({ abi: erc20Abi, eventName: "Transfer", args: { from, to } }),
    } as Log;
    expect(hasExactTransfer([log], expected)).toBe(true);
    expect(hasExactTransfer([{ ...log, address: from }], expected)).toBe(false);
    expect(hasExactTransfer([log], { ...expected, amount: "10001" })).toBe(false);
    expect(hasExactTransfer([log], { ...expected, recipient: from })).toBe(false);
    expect(hasExactTransfer([], expected)).toBe(false);
  });
});
