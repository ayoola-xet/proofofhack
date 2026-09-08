import { toHex } from "viem";
import { ADAPTER_ID, type BountyPolicy } from "../../packages/domain/src/index.ts";
export const h = (n: number) => toHex(n, { size: 32 });
export const a = (n: number) => toHex(n, { size: 20 });
export const examplePolicy = (): BountyPolicy => ({
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
