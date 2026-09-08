import { z } from "zod";
import { ownerCommandSchema } from "../../../packages/chain/src/owner-command.ts";
import {
  address,
  bytes32,
  MAX_EVIDENCE_BYTES,
  role,
  uint,
} from "../../../packages/domain/src/index.ts";
import { filtersSchema } from "../../receipts/src/records.ts";

const nameSchema = z.string().trim().min(2).max(80);
export const rpcItemSchema = z.strictObject({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string().max(100), z.number().int(), z.null()]),
  method: z.string(),
  params: z.array(z.unknown()).max(5).default([]),
});
export const requestSchemas = {
  organization: z.strictObject({ name: nameSchema }),
  member: z.strictObject({ userId: z.uuid(), role }),
  memberUpdate: z
    .strictObject({ role: role.optional(), status: z.enum(["ACTIVE", "DISABLED"]).optional() })
    .refine((v) => v.role !== undefined || v.status !== undefined),
  coveragePolicy: z.strictObject({
    minReward: uint().refine((v) => BigInt(v) > 0n),
    maxDataAgeSeconds: z.number().int().min(30).max(86400),
    allowedVaultIds: z.array(z.uuid()).max(100),
  }),
  program: z.strictObject({ name: nameSchema, coveragePolicyId: z.uuid().optional() }),
  assistantQuestion: z.strictObject({ question: z.string().trim().min(3).max(500) }),
  empty: z.strictObject({}),
  prepareManifest: z.strictObject({ vaultId: z.uuid(), signingWalletId: z.uuid() }),
  signature: z.strictObject({ signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/) }),
  bountyDraft: z
    .strictObject({
      manifestId: z.uuid(),
      refundWalletId: z.uuid().optional(),
      controllerId: z.uuid().optional(),
      reward: uint().refine((v) => BigInt(v) > 0n),
      minimumDiscrepancy: uint().refine((v) => BigInt(v) > 0n),
      submissionDeadline: uint(64),
      reservationDurationSeconds: z.number().int().min(60).max(1800),
      settlementGraceSeconds: z.number().int().min(0).max(86400).default(3600),
    })
    .refine((v) => Boolean(v.refundWalletId) !== Boolean(v.controllerId), {
      message: "Select one refund wallet or budget controller.",
    }),
  policyHash: z.strictObject({ policyHash: bytes32 }),
  controller: z.strictObject({
    address,
    deploymentHash: bytes32,
    ownerWalletId: z.uuid(),
    operatorWalletId: z.uuid(),
  }),
  syncApproval: z.strictObject({ draftId: z.uuid() }),
  allocation: z.strictObject({ recommendationId: z.uuid() }),
  upload: z.strictObject({
    keyId: bytes32,
    algorithm: z.literal("X25519_SEALED_BOX"),
    ciphertextHash: bytes32,
    byteLength: z
      .number()
      .int()
      .min(49)
      .max(MAX_EVIDENCE_BYTES + 48),
    claimantWalletId: z.uuid(),
  }),
  vault: z.strictObject({ sourceId: z.string().max(100) }),
  fundingRequest: z.strictObject({
    policyHash: bytes32,
    walletId: z.uuid(),
    authorizationWalletId: z.uuid(),
  }),
  ownerRequest: z.strictObject({ command: ownerCommandSchema, authorizationWalletId: z.uuid() }),
  transactionHash: z.strictObject({ transactionHash: bytes32 }),
  treasurySetup: z.strictObject({
    maxPerAction: uint().refine((v) => BigInt(v) > 0n && BigInt(v) <= 100000000n),
  }),
  transfer: z.strictObject({ to: address, amount: uint().refine((v) => BigInt(v) > 0n) }),
  receiptFilters: filtersSchema,
  arcRpc: z.union([rpcItemSchema, z.array(rpcItemSchema).min(1).max(10)]),
};

export const headerSchemas = {
  idempotency: z
    .string()
    .min(16)
    .max(128)
    .regex(/^[a-zA-Z0-9:_-]+$/),
  version: z
    .string()
    .regex(/^"?[1-9][0-9]*"?$/)
    .refine((value) => Number.isSafeInteger(Number(value.replaceAll('"', "")))),
};
export const pathSchemas = {
  uuid: z.object({ id: z.uuid() }),
  hash: z.object({ id: bytes32 }),
  member: z.object({ id: z.uuid(), userId: z.uuid() }),
  wallet: z.object({ id: z.uuid(), walletId: z.uuid() }),
};
export const hashPageParams = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: bytes32.optional(),
});
