import { readFile } from "node:fs/promises";
import { encodeFunctionData, type Hex, parseAbiItem } from "viem";
import { describe, expect, it } from "vitest";
import { type ClaimCall, encodeClaimCall } from "../packages/chain/src/claim-calls.ts";
import {
  encodeRecoveryCall,
  type RecoveryCall,
  recoveryRequestKey,
} from "../packages/chain/src/recovery.ts";
import {
  CircleClaimRelayer,
  circleClaimArguments,
  circleRequestId,
} from "../packages/circle/src/claims.ts";

const h = (i: number) => `0x${i.toString(16).padStart(64, "0")}` as Hex;
const a = (i: number) => `0x${i.toString(16).padStart(40, "0")}` as Hex;
const signature = `0x${"11".repeat(65)}` as Hex;
const admission = {
  bountyId: h(1),
  claimId: h(2),
  claimant: a(1),
  evidenceCommitment: h(3),
  authorizationNonce: h(4),
  validUntil: "1000",
};
const calls: ClaimCall[] = [
  { method: "reserveClaim", payload: admission, signature },
  {
    method: "submitAssessment",
    payload: {
      bountyId: h(1),
      claimId: h(2),
      claimant: a(1),
      evidenceCommitment: h(3),
      policyHash: h(1),
      caseNullifier: h(5),
      reportHash: h(6),
      adapterCodeHash: h(7),
      verifierConfigHash: h(8),
      outcome: "1",
      reward: "1000000",
      assessedAt: "500",
      validUntil: "1000",
    },
    signature,
  },
  { method: "collectPayment", payload: { bountyId: h(1) } },
];
describe("Circle claim bridge", () => {
  it("pins recovery calls to the escrow, saved bounty, reservation, and zero native value", async () => {
    const commands: string[][] = [];
    const relayer = new CircleClaimRelayer(
      "00000000-0000-4000-8000-000000000001",
      a(8),
      a(9),
      async (args) => {
        commands.push(args);
        return {
          id: "provider",
          idempotencyKey: args[args.indexOf("--idempotency-key") + 1],
          txHash: h(99),
          blockchain: "ARC-TESTNET",
          sourceAddress: a(8),
          contractAddress: a(9),
          state: "CONFIRMED",
        };
      },
    );
    const recovery: RecoveryCall[] = [
      { method: "expireReservation", bountyId: h(1), claimId: h(2) },
      { method: "refundExpired", bountyId: h(1) },
    ];
    for (const call of recovery) {
      const key = recoveryRequestKey(call, "1");
      await relayer.sendRecovery(key, a(9), call, "1", "00000000-0000-4000-8000-000000000002");
      const command = commands.at(-1) as string[];
      expect(command[command.indexOf("--amount") + 1]).toBe("0");
      expect(command[command.indexOf("--contract") + 1]).toBe(a(9));
      expect(
        encodeFunctionData({
          abi: [parseAbiItem(`function ${command[2]}`)],
          functionName: call.method,
          args: [command[3]],
        }),
      ).toBe(encodeRecoveryCall(call));
      await expect(
        relayer.sendRecovery(key, a(7), call, "1", "00000000-0000-4000-8000-000000000002"),
      ).rejects.toMatchObject({
        code: "RELAYER_SCOPE",
      });
      await expect(
        relayer.sendRecovery(
          key,
          a(9),
          { ...call, bountyId: h(4) },
          "1",
          "00000000-0000-4000-8000-000000000002",
        ),
      ).rejects.toMatchObject({ code: "RELAYER_SCOPE" });
      await expect(
        relayer.sendRecovery(key, a(9), call, "2", "00000000-0000-4000-8000-000000000002"),
      ).rejects.toMatchObject({
        code: "RELAYER_SCOPE",
      });
    }
    expect(commands).toHaveLength(2);
    expect(() => recoveryRequestKey(recovery[0], "6")).toThrow();
  });
  it("round-trips all signed tuple fields through the installed CLI parser", async () => {
    const source = await readFile("node_modules/@circle-fin/cli/dist/index.js", "utf8");
    const match = source.match(
      /const abiParameters = pos\.slice\(1\)\.map\(\(value\) => \{([\s\S]*?)\n {2}\}\);/,
    );
    if (!match) throw new Error("The installed CLI tuple parser patch is missing.");
    // The installed, pinned package parser receives only synthetic local values.
    const parser = new Function("value", match[1]);
    for (const call of calls) {
      const [signature, ...params] = circleClaimArguments(call);
      const data = encodeFunctionData({
        abi: [parseAbiItem(`function ${signature}`)],
        functionName: call.method,
        args: params.map((v) => parser(v)),
      });
      expect(data).toBe(encodeClaimCall(call));
    }
  });
  it("uses one provider request ID after a lost response and checks its bindings", async () => {
    const saved: string[][] = [];
    const relayer = new CircleClaimRelayer(
      "00000000-0000-4000-8000-000000000001",
      a(8),
      a(9),
      async (args) => {
        saved.push(args);
        if (saved.length === 1) throw new Error("Lost provider response");
        return {
          id: "provider-id",
          idempotencyKey: args[args.indexOf("--idempotency-key") + 1],
          txHash: h(99),
          blockchain: "ARC-TESTNET",
          sourceAddress: a(8),
          contractAddress: a(9),
          state: "CONFIRMED",
        };
      },
    );
    const key = `${h(2)}:reserveClaim`;
    await expect(
      relayer.send(key, a(9), calls[0], "00000000-0000-4000-8000-000000000002"),
    ).rejects.toThrow("Lost provider response");
    expect(await relayer.send(key, a(9), calls[0], "00000000-0000-4000-8000-000000000002")).toEqual(
      {
        hash: h(99),
        providerId: "provider-id",
      },
    );
    expect(saved[0]).toEqual(saved[1]);
    expect(saved[0][saved[0].indexOf("--idempotency-key") + 1]).toBe(
      "00000000-0000-4000-8000-000000000002",
    );
    await expect(relayer.send(key, a(9), calls[0], circleRequestId(key))).rejects.toThrow();
    await expect(
      relayer.send(key, a(7), calls[0], "00000000-0000-4000-8000-000000000002"),
    ).rejects.toMatchObject({
      code: "RELAYER_SCOPE",
    });
    await expect(
      relayer.send(`${h(4)}:reserveClaim`, a(9), calls[0], "00000000-0000-4000-8000-000000000002"),
    ).rejects.toMatchObject({
      code: "RELAYER_SCOPE",
    });
    expect(saved).toHaveLength(2);
  });
  it("rejects a mismatched provider wallet or request", async () => {
    const relayer = new CircleClaimRelayer(
      "00000000-0000-4000-8000-000000000001",
      a(8),
      a(9),
      async () => ({
        id: "provider-id",
        idempotencyKey: "wrong",
        txHash: h(99),
        blockchain: "ARC-TESTNET",
        sourceAddress: a(7),
        contractAddress: a(9),
        state: "CONFIRMED",
      }),
    );
    await expect(
      relayer.send(`${h(2)}:reserveClaim`, a(9), calls[0], "00000000-0000-4000-8000-000000000002"),
    ).rejects.toMatchObject({
      code: "CIRCLE_RESPONSE_MISMATCH",
    });
  });
});
