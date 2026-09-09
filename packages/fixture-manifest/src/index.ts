import { SimpleMerkleTree } from "@openzeppelin/merkle-tree";
import { type Hex, recoverMessageAddress } from "viem";
import { z } from "zod";
import { canonicalJson, hashCanonical } from "../../crypto-envelope/src/index.ts";
import { leafHash } from "../../domain/src/fixture-leaf.ts";
import { address, bytes32, DomainError, fixtureSchema, uint } from "../../domain/src/index.ts";

export const manifestSchema = z.strictObject({
  schemaVersion: z.literal("1"),
  synthetic: z.literal(true),
  root: bytes32,
  organizationId: bytes32,
  sourceChainId: uint(),
  sourceVault: address,
  sourceBlockHash: bytes32,
  createdAt: uint(64),
  version: z.literal("1"),
  ownerAddress: address,
  cases: z
    .array(
      z.strictObject({
        label: z.enum(["QUALIFYING", "ZERO_CONTROL", "BELOW_THRESHOLD"]),
        leafHash: bytes32,
      }),
    )
    .length(3),
});
export type FixtureManifest = z.infer<typeof manifestSchema>;
export function createManifestCases(salts: readonly Hex[], caseIds: readonly Hex[]) {
  if (salts.length !== 3 || caseIds.length !== 3)
    throw new Error("Provide three separate fixture salts and IDs.");
  const values = [
    { label: "QUALIFYING" as const, expectedAssets: "100000000", observedAssets: "90000000" },
    { label: "ZERO_CONTROL" as const, expectedAssets: "100000000", observedAssets: "100000000" },
    { label: "BELOW_THRESHOLD" as const, expectedAssets: "100000000", observedAssets: "99500000" },
  ];
  const fixtures = values.map((v, i) =>
    fixtureSchema.parse({
      schemaVersion: "1",
      manifestVersion: "1",
      caseId: caseIds[i],
      salt: salts[i],
      expectedAssets: v.expectedAssets,
      observedAssets: v.observedAssets,
      merkleProof: [],
    }),
  );
  const tree = SimpleMerkleTree.of(fixtures.map(leafHash));
  return {
    root: tree.root as Hex,
    fixtures: fixtures.map((f, i) => ({
      label: values[i].label,
      fixture: { ...f, merkleProof: tree.getProof(i) },
    })),
    cases: fixtures.map((f, i) => ({ label: values[i].label, leafHash: leafHash(f) })),
  };
}
export function manifestMessage(input: unknown) {
  return `ProofOfHack synthetic fixture manifest v1\n${canonicalJson(manifestSchema.parse(input))}`;
}
export async function verifyManifest(input: unknown, signature: Hex) {
  const manifest = manifestSchema.parse(input);
  if (
    new Set(manifest.cases.map((c) => c.label)).size !== 3 ||
    new Set(manifest.cases.map((c) => c.leafHash)).size !== 3 ||
    SimpleMerkleTree.of(manifest.cases.map((c) => c.leafHash)).root !== manifest.root
  )
    throw new DomainError(
      "INVALID_MANIFEST",
      "The fixture manifest commitments do not match.",
      400,
    );
  let signer: string;
  try {
    signer = await recoverMessageAddress({ message: manifestMessage(manifest), signature });
  } catch {
    throw new DomainError("INVALID_MANIFEST_SIGNATURE", "The fixture signature is not valid.", 400);
  }
  if (signer.toLowerCase() !== manifest.ownerAddress)
    throw new DomainError(
      "MANIFEST_SIGNATURE_MISMATCH",
      "The manifest owner signature does not match.",
      400,
    );
  return { manifest, manifestHash: hashCanonical(manifest) };
}
