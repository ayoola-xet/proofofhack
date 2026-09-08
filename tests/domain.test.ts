import { SimpleMerkleTree } from "@openzeppelin/merkle-tree";
import { type Hex, toHex } from "viem";
import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  createEncryptionKeyPair,
  decryptReport,
  encryptReport,
  hashCanonical,
  seal,
  unseal,
} from "../packages/crypto-envelope/src/index.ts";
import {
  ADAPTER_ID,
  type BountyPolicy,
  type Fixture,
  fixtureSchema,
  formatMoney,
  hashPolicy,
  parseMoney,
  policySchema,
} from "../packages/domain/src/index.ts";
import { assessFixture, leafHash } from "../services/verifier/src/fixture.ts";

const h = (n: number) => toHex(n, { size: 32 });
const a = (n: number) => toHex(n, { size: 20 });
const examplePolicy = (): BountyPolicy => ({
  settlementChainId: "31337",
  escrow: a(1),
  organizationId: h(1),
  refundRecipient: a(2),
  sourceChainId: "1",
  sourceVault: a(3),
  sourceBlockHash: h(2),
  fixtureManifestRoot: h(3),
  adapterId: ADAPTER_ID,
  adapterCodeHash: h(5),
  verifierConfigHash: h(6),
  admissionSigner: a(4),
  verdictSigner: a(5),
  reportRecipientKeyId: h(7),
  asset: a(6),
  reward: "25000000",
  minimumDiscrepancy: "1000000",
  submissionDeadline: "1800086400",
  settlementDeadline: "1800088200",
  reservationDurationSeconds: "1800",
  organizationNonce: h(1),
});
const fixtures: Fixture[] = ["5000000", "10000000", "9500000"].map((observedAssets, i) => ({
  schemaVersion: "1",
  manifestVersion: "1",
  caseId: h(i + 1),
  expectedAssets: "10000000",
  observedAssets,
  salt: h(i + 10),
  merkleProof: [],
}));
const tree = SimpleMerkleTree.of(fixtures.map(leafHash));
const fixtureWithProof = (i: number): Fixture => ({
  ...fixtures[i],
  merkleProof: tree.getProof(i) as Hex[],
});

describe("Financial and schema rules", () => {
  it("OPS-04 preserves exact integer amounts and rejects rounding", () => {
    expect(parseMoney("9007199254740993.000001")).toBe(9007199254740993000001n);
    expect(formatMoney(9007199254740993000001n)).toBe("9007199254740993.000001");
    for (const value of ["1e6", "-1", "0.0000001", "NaN", "01", "1."])
      expect(() => parseMoney(value)).toThrow();
  });
  it("Rejects unknown policy fields and invalid reservation terms", () => {
    expect(() => policySchema.parse({ ...examplePolicy(), mutable: true })).toThrow();
    expect(() =>
      policySchema.parse({ ...examplePolicy(), reservationDurationSeconds: "1801" }),
    ).toThrow();
    expect(() => policySchema.parse({ ...examplePolicy(), settlementDeadline: "1" })).toThrow();
  });
  it("Policy hashes bind the payout and claimant-independent terms", () => {
    expect(hashPolicy(examplePolicy())).not.toBe(
      hashPolicy({ ...examplePolicy(), reward: "25000001" }),
    );
    expect(hashPolicy(examplePolicy())).toBe(hashPolicy({ ...examplePolicy() }));
  });
});

describe("Fixed fixture assessment", () => {
  const policy = { ...examplePolicy(), fixtureManifestRoot: tree.root };
  const context = { claimId: h(40), bountyId: hashPolicy(policy), assessedAt: 1800000000n };
  it("VER-01 qualifies only a manifest record above the threshold", () => {
    const result = assessFixture(fixtureWithProof(0), policy, context);
    expect(result.report.outcome).toBe("QUALIFIES");
    expect(result.report.discrepancy).toBe("5000000");
    expect(result.report.evidenceScope).toBe("FIXTURE_ONLY");
  });
  it("VER-02 and VER-03 reject control and below-threshold cases", () => {
    for (const i of [1, 2])
      expect(assessFixture(fixtureWithProof(i), policy, context).report.outcome).toBe(
        "DOES_NOT_QUALIFY",
      );
  });
  it("VER-04 rejects changed committed input", () => {
    expect(() =>
      assessFixture({ ...fixtureWithProof(0), observedAssets: "0" }, policy, context),
    ).toThrow(/manifest/);
  });
  it("VER-05 accepts no transaction instructions or external URLs", () => {
    for (const extra of [{ url: "https://example.com" }, { calldata: "0x00" }, { script: "1+1" }])
      expect(() => fixtureSchema.parse({ ...fixtureWithProof(0), ...extra })).toThrow();
  });
  it("VER-08 report hashing is stable and rejects ambiguous number encodings", () => {
    expect(hashCanonical({ b: "2", a: "1" })).toBe(hashCanonical({ a: "1", b: "2" }));
    expect(() => canonicalJson({ amount: 1 })).toThrow();
    const first = assessFixture(fixtureWithProof(0), policy, context);
    const second = assessFixture(fixtureWithProof(0), policy, context);
    expect(first.reportHash).toBe(second.reportHash);
  });
});

describe("Confidential envelopes", () => {
  it("PRI-01 encrypts evidence for the verifier only", async () => {
    const keys = await createEncryptionKeyPair();
    const other = await createEncryptionKeyPair();
    const plaintext = new TextEncoder().encode("unique-private-fixture-marker");
    const ciphertext = await seal(plaintext, keys.publicKey);
    expect(new TextDecoder().decode(ciphertext)).not.toContain("unique-private-fixture-marker");
    expect(await unseal(ciphertext, keys)).toEqual(plaintext);
    await expect(unseal(ciphertext, other)).rejects.toThrow();
  });
  it("PRI-05 authenticates stored reports and rejects tampering", async () => {
    const keys = await createEncryptionKeyPair();
    const plaintext = new TextEncoder().encode(canonicalJson({ outcome: "QUALIFIES" }));
    const envelope = await encryptReport(plaintext, keys.publicKey);
    expect(await decryptReport(envelope, keys)).toEqual(plaintext);
    const changed = {
      ...envelope,
      ciphertext: `${envelope.ciphertext[0] === "A" ? "B" : "A"}${envelope.ciphertext.slice(1)}`,
    };
    await expect(decryptReport(changed, keys)).rejects.toThrow();
  });
});
