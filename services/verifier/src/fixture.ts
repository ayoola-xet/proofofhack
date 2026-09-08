import { SimpleMerkleTree } from "@openzeppelin/merkle-tree";
import { encodeAbiParameters, type Hex, keccak256, parseAbiParameters, toHex } from "viem";
import { hashCanonical } from "../../../packages/crypto-envelope/src/index.ts";
import {
  ADAPTER_ID,
  bytes32,
  EVIDENCE_SCOPE,
  type Fixture,
  fixtureSchema,
  hashPolicy,
  policySchema,
  VERIFIER_MODE,
} from "../../../packages/domain/src/index.ts";

export const FIXTURE_LEAF_TYPEHASH = keccak256(
  toHex("FixtureLeafV1(bytes32 caseId,uint256 expectedAssets,uint256 observedAssets,bytes32 salt)"),
);
export const leafHash = (fixture: Fixture) =>
  keccak256(
    encodeAbiParameters(parseAbiParameters("bytes32, bytes32, uint256, uint256, bytes32"), [
      FIXTURE_LEAF_TYPEHASH,
      fixture.caseId,
      BigInt(fixture.expectedAssets),
      BigInt(fixture.observedAssets),
      fixture.salt,
    ]),
  );

export function assessFixture(
  input: unknown,
  policyInput: unknown,
  context: { claimId: Hex; bountyId: Hex; assessedAt: bigint },
) {
  const fixture = fixtureSchema.parse(input);
  const policy = policySchema.parse(policyInput);
  if (hashPolicy(policy) !== context.bountyId) throw new Error("Policy commitment mismatch.");
  if (policy.adapterId !== ADAPTER_ID) throw new Error("Unsupported fixture adapter.");
  const leaf = leafHash(fixture);
  if (!SimpleMerkleTree.verify(policy.fixtureManifestRoot, leaf, fixture.merkleProof))
    throw new Error("The fixture is not part of the committed manifest.");
  const expected = BigInt(fixture.expectedAssets);
  const observed = BigInt(fixture.observedAssets);
  const discrepancy = expected > observed ? expected - observed : 0n;
  const outcome =
    discrepancy >= BigInt(policy.minimumDiscrepancy) ? "QUALIFIES" : "DOES_NOT_QUALIFY";
  const report = {
    schemaVersion: "1",
    claimId: bytes32.parse(context.claimId),
    bountyId: bytes32.parse(context.bountyId),
    policyHash: context.bountyId,
    evidenceScope: EVIDENCE_SCOPE,
    verifierMode: VERIFIER_MODE,
    caseId: fixture.caseId,
    fixtureLeafHash: leaf,
    sourceContext: {
      chainId: policy.sourceChainId,
      vault: policy.sourceVault,
      blockHash: policy.sourceBlockHash,
    },
    expectedAssets: fixture.expectedAssets,
    observedAssets: fixture.observedAssets,
    discrepancy: discrepancy.toString(),
    minimumDiscrepancy: policy.minimumDiscrepancy,
    outcome,
    explanationCode:
      outcome === "QUALIFIES" ? "FIXTURE_THRESHOLD_MET" : "FIXTURE_THRESHOLD_NOT_MET",
    limitation:
      "This is synthetic fixture evidence. It does not establish a vulnerability in the source vault.",
    assessedAt: context.assessedAt.toString(),
  };
  return {
    report,
    reportHash: hashCanonical(report),
    caseNullifier: keccak256(
      encodeAbiParameters(parseAbiParameters("bytes32, bytes32"), [context.bountyId, leaf]),
    ),
  };
}
