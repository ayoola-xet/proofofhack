import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeAbiParameters, encodeEventTopics, erc20Abi, type Hex } from "viem";
import { expect, it } from "vitest";
import { ARC_USDC } from "../packages/chain/src/arc.ts";
import type { FundingReceipt } from "../packages/chain/src/funding.ts";
import { expectedEventSchema, verifyLiveEvent } from "../scripts/live-event-check.ts";
import { readArtifact, rejectSecrets, sha256 } from "../scripts/release-evidence.ts";
import { a, h } from "./helpers/policy.ts";

it("Rejects changed event fields, block references, missing logs, and ambiguous transfers", () => {
  const expected = expectedEventSchema.parse({
    name: "Transfer",
    contract: ARC_USDC,
    transactionHash: h(10),
    blockHash: h(11),
    blockNumber: "12",
    fields: { from: a(1), to: a(2), value: "1000000" },
  });
  const receipt: FundingReceipt = {
    hash: h(10),
    blockHash: h(11),
    blockNumber: 12n,
    status: "success",
    logs: [
      {
        address: ARC_USDC,
        topics: encodeEventTopics({
          abi: erc20Abi,
          eventName: "Transfer",
          args: { from: a(1), to: a(2) },
        }) as [Hex, ...Hex[]],
        data: encodeAbiParameters([{ type: "uint256" }], [1000000n]),
        blockHash: h(11),
        blockNumber: 12n,
        transactionHash: h(10),
        transactionIndex: 0,
        logIndex: 5,
        removed: false,
      },
    ],
  };
  expect(() => verifyLiveEvent(expected, receipt)).not.toThrow();
  for (const changed of [
    { ...expected, blockHash: h(90) },
    { ...expected, blockNumber: "13" },
    { ...expected, contract: a(9) },
    { ...expected, logIndex: 6 },
    { ...expected, fields: { ...expected.fields, value: "2000000" } },
    { ...expected, fields: { ...expected.fields, to: a(9) } },
  ])
    expect(() => verifyLiveEvent(changed, receipt)).toThrow();
  expect(() => verifyLiveEvent(expected, { ...receipt, status: "reverted" })).toThrow();
  expect(() =>
    verifyLiveEvent(expected, { ...receipt, logs: [{ ...receipt.logs[0], removed: true }] }),
  ).toThrow();
  expect(() =>
    verifyLiveEvent(expected, {
      ...receipt,
      logs: [receipt.logs[0], { ...receipt.logs[0], logIndex: 6 }],
    }),
  ).toThrow();
  expect(expectedEventSchema.safeParse({ ...expected, fields: {} }).success).toBe(false);
});
it("Checks exact artifact bytes and rejects paths outside evidence, including symlinks", async () => {
  const root = await mkdtemp(join(tmpdir(), "proofofhack-evidence-"));
  try {
    await mkdir(join(root, "evidence"));
    await writeFile(join(root, "evidence", "valid.json"), '{"result":"PASS"}\n');
    const first = await readArtifact("evidence/valid.json", root);
    expect(first.reference.sha256).toBe(sha256('{"result":"PASS"}\n'));
    await writeFile(join(root, "evidence", "valid.json"), '{"result":"FAIL"}\n');
    expect((await readArtifact("evidence/valid.json", root)).reference.sha256).not.toBe(
      first.reference.sha256,
    );
    await writeFile(join(root, "outside.json"), "{}");
    await expect(readArtifact("evidence/../outside.json", root)).rejects.toThrow();
    await symlink(join(root, "outside.json"), join(root, "evidence", "escape.json"));
    await expect(readArtifact("evidence/escape.json", root)).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("Rejects nested credentials while allowing public addresses and hashes", () => {
  expect(() => rejectSecrets({ claimId: h(1), address: a(1), reportHash: h(2) })).not.toThrow();
  for (const value of [
    { privateKey: h(1) },
    { nested: [{ refresh_token: "secret" }] },
    { message: "Bearer abcdefghijklmnopqrstuvwxyz" },
    { key: "-----BEGIN PRIVATE KEY-----" },
  ])
    expect(() => rejectSecrets(value)).toThrow();
});
