import { encodeFunctionData, type Hex } from "viem";
import { z } from "zod";
import { address, bytes32, uint } from "../../domain/src/index.ts";
import { bountyEscrowAbi } from "./abi/BountyEscrow.ts";
export const admissionSchema = z.strictObject({
  bountyId: bytes32,
  claimId: bytes32,
  claimant: address,
  evidenceCommitment: bytes32,
  authorizationNonce: bytes32,
  validUntil: uint(64),
});
export const assessmentSchema = z.strictObject({
  bountyId: bytes32,
  policyHash: bytes32,
  claimId: bytes32,
  claimant: address,
  evidenceCommitment: bytes32,
  caseNullifier: bytes32,
  reportHash: bytes32,
  adapterCodeHash: bytes32,
  verifierConfigHash: bytes32,
  outcome: z.enum(["1", "2"]),
  reward: uint(),
  assessedAt: uint(64),
  validUntil: uint(64),
});
const signature = z
  .string()
  .regex(/^0x[0-9a-fA-F]{130}$/)
  .transform((v) => v as Hex);
export const claimCallSchema = z.discriminatedUnion("method", [
  z.strictObject({ method: z.literal("reserveClaim"), payload: admissionSchema, signature }),
  z.strictObject({ method: z.literal("submitAssessment"), payload: assessmentSchema, signature }),
  z.strictObject({
    method: z.literal("collectPayment"),
    payload: z.strictObject({ bountyId: bytes32 }),
  }),
]);
export type ClaimCall = z.infer<typeof claimCallSchema>;
export function encodeClaimCall(input: ClaimCall): Hex {
  const call = claimCallSchema.parse(input);
  if (call.method === "reserveClaim")
    return encodeFunctionData({
      abi: bountyEscrowAbi,
      functionName: call.method,
      args: [{ ...call.payload, validUntil: BigInt(call.payload.validUntil) }, call.signature],
    });
  if (call.method === "submitAssessment")
    return encodeFunctionData({
      abi: bountyEscrowAbi,
      functionName: call.method,
      args: [
        {
          ...call.payload,
          outcome: Number(call.payload.outcome),
          reward: BigInt(call.payload.reward),
          assessedAt: BigInt(call.payload.assessedAt),
          validUntil: BigInt(call.payload.validUntil),
        },
        call.signature,
      ],
    });
  return encodeFunctionData({
    abi: bountyEscrowAbi,
    functionName: call.method,
    args: [call.payload.bountyId],
  });
}
