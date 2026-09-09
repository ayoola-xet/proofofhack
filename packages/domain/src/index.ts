import {
  type AbiParameter,
  type Address,
  encodeAbiParameters,
  type Hex,
  isAddress,
  keccak256,
  toHex,
} from "viem";
import { z } from "zod";

export const uint = (bits = 256) =>
  z
    .string()
    .regex(/^(0|[1-9][0-9]*)$/)
    .max(78)
    .refine((value) => BigInt(value) < 1n << BigInt(bits), `Exceeds uint${bits}`);
export const bytes32 = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/)
  .transform((value) => value.toLowerCase() as Hex);
export const address = z
  .string()
  .refine((value) => isAddress(value, { strict: false }), "Invalid address")
  .transform((value) => value.toLowerCase() as Address);
export const role = z.enum(["OWNER", "TREASURY", "REVIEWER", "VIEWER"]);
export const environment = z.enum(["local", "arc-testnet"]);
export const VERIFIER_MODE = "TRUSTED_SERVICE" as const;
export const EVIDENCE_SCOPE = "FIXTURE_ONLY" as const;
export const ADAPTER_ID = keccak256(toHex("ACCOUNTING_FIXTURE_V1"));
export const MAX_EVIDENCE_BYTES = 256 * 1024;

export const policySchema = z
  .strictObject({
    settlementChainId: uint(),
    escrow: address,
    organizationId: bytes32,
    refundRecipient: address,
    sourceChainId: uint(),
    sourceVault: address,
    sourceBlockHash: bytes32,
    fixtureManifestRoot: bytes32,
    adapterId: bytes32,
    adapterCodeHash: bytes32,
    verifierConfigHash: bytes32,
    admissionSigner: address,
    verdictSigner: address,
    reportRecipientKeyId: bytes32,
    asset: address,
    reward: uint(),
    minimumDiscrepancy: uint(),
    submissionDeadline: uint(64),
    settlementDeadline: uint(64),
    reservationDurationSeconds: uint(32),
    organizationNonce: bytes32,
  })
  .superRefine((p, ctx) => {
    const duration = BigInt(p.reservationDurationSeconds);
    if (duration < 60n || duration > 1800n)
      ctx.addIssue({
        code: "custom",
        path: ["reservationDurationSeconds"],
        message: "Use 60 to 1800 seconds.",
      });
    if (BigInt(p.settlementDeadline) < BigInt(p.submissionDeadline) + duration)
      ctx.addIssue({
        code: "custom",
        path: ["settlementDeadline"],
        message: "Keep a full reservation window after submissions close.",
      });
    for (const key of [
      "reward",
      "minimumDiscrepancy",
      "sourceChainId",
      "settlementChainId",
    ] as const) {
      if (BigInt(p[key]) === 0n)
        ctx.addIssue({ code: "custom", path: [key], message: "Must be greater than zero." });
    }
    for (const key of [
      "escrow",
      "refundRecipient",
      "sourceVault",
      "admissionSigner",
      "verdictSigner",
      "asset",
    ] as const) {
      if (BigInt(p[key]) === 0n)
        ctx.addIssue({ code: "custom", path: [key], message: "Zero address is not allowed." });
    }
    for (const key of [
      "organizationId",
      "organizationNonce",
      "fixtureManifestRoot",
      "reportRecipientKeyId",
      "adapterId",
      "adapterCodeHash",
      "verifierConfigHash",
      "sourceBlockHash",
    ] as const) {
      if (BigInt(p[key]) === 0n)
        ctx.addIssue({ code: "custom", path: [key], message: "Zero commitment is not allowed." });
    }
  });
export type BountyPolicy = z.infer<typeof policySchema>;

export const policyFields = [
  { name: "settlementChainId", type: "uint256" },
  { name: "escrow", type: "address" },
  { name: "organizationId", type: "bytes32" },
  { name: "refundRecipient", type: "address" },
  { name: "sourceChainId", type: "uint256" },
  { name: "sourceVault", type: "address" },
  { name: "sourceBlockHash", type: "bytes32" },
  { name: "fixtureManifestRoot", type: "bytes32" },
  { name: "adapterId", type: "bytes32" },
  { name: "adapterCodeHash", type: "bytes32" },
  { name: "verifierConfigHash", type: "bytes32" },
  { name: "admissionSigner", type: "address" },
  { name: "verdictSigner", type: "address" },
  { name: "reportRecipientKeyId", type: "bytes32" },
  { name: "asset", type: "address" },
  { name: "reward", type: "uint256" },
  { name: "minimumDiscrepancy", type: "uint256" },
  { name: "submissionDeadline", type: "uint64" },
  { name: "settlementDeadline", type: "uint64" },
  { name: "reservationDurationSeconds", type: "uint32" },
  { name: "organizationNonce", type: "bytes32" },
] as const;
export const policyType = `BountyPolicyV1(${policyFields.map((field) => `${field.type} ${field.name}`).join(",")})`;
export const POLICY_TYPEHASH = keccak256(toHex(policyType));
export function hashPolicy(input: unknown): Hex {
  const p = policySchema.parse(input);
  const parameters: readonly AbiParameter[] = [{ type: "bytes32" }, ...policyFields];
  return keccak256(
    encodeAbiParameters(parameters, [
      POLICY_TYPEHASH,
      ...policyFields.map((field) =>
        field.type.startsWith("uint") ? BigInt(p[field.name]) : p[field.name],
      ),
    ]),
  );
}

export const admissionFields = [
  { name: "bountyId", type: "bytes32" },
  { name: "claimId", type: "bytes32" },
  { name: "claimant", type: "address" },
  { name: "evidenceCommitment", type: "bytes32" },
  { name: "authorizationNonce", type: "bytes32" },
  { name: "validUntil", type: "uint64" },
] as const;
export const assessmentFields = [
  { name: "bountyId", type: "bytes32" },
  { name: "policyHash", type: "bytes32" },
  { name: "claimId", type: "bytes32" },
  { name: "claimant", type: "address" },
  { name: "evidenceCommitment", type: "bytes32" },
  { name: "caseNullifier", type: "bytes32" },
  { name: "reportHash", type: "bytes32" },
  { name: "adapterCodeHash", type: "bytes32" },
  { name: "verifierConfigHash", type: "bytes32" },
  { name: "outcome", type: "uint8" },
  { name: "reward", type: "uint256" },
  { name: "assessedAt", type: "uint64" },
  { name: "validUntil", type: "uint64" },
] as const;
export const signingDomain = (chainId: number, verifyingContract: Address) =>
  ({ name: "ProofOfHack", version: "1", chainId, verifyingContract }) as const;

export const fixtureSchema = z.strictObject({
  schemaVersion: z.literal("1"),
  manifestVersion: z.literal("1"),
  caseId: bytes32,
  expectedAssets: uint(),
  observedAssets: uint(),
  salt: bytes32,
  merkleProof: z.array(bytes32).max(32),
});
export type Fixture = z.infer<typeof fixtureSchema>;

export function parseMoney(value: string, decimals = 6): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18)
    throw new Error("Invalid decimals.");
  if (!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value))
    throw new Error("Enter a positive decimal amount.");
  const [whole, fractional = ""] = value.split(".");
  if (fractional.length > decimals) throw new Error(`Use at most ${decimals} decimal places.`);
  const result =
    BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fractional.padEnd(decimals, "0") || "0");
  if (result >= 1n << 256n) throw new Error("Amount is too large.");
  return result;
}
export function formatMoney(value: bigint, decimals = 6): string {
  if (value < 0n || !Number.isInteger(decimals) || decimals < 0 || decimals > 18)
    throw new Error("Invalid amount.");
  const scale = 10n ** BigInt(decimals);
  const remainder = (value % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${value / scale}${remainder ? `.${remainder}` : ""}`;
}
export const organizationHash = (uuid: string): Hex =>
  keccak256(toHex(`ProofOfHack:organization:v1:${z.uuid().parse(uuid).toLowerCase()}`));

export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 409,
  ) {
    super(message);
  }
}
