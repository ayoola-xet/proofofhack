import type { BountyPolicy } from "../../domain/src/index.ts";
export function contractPolicy(p: BountyPolicy) {
  return {
    ...p,
    settlementChainId: BigInt(p.settlementChainId),
    sourceChainId: BigInt(p.sourceChainId),
    reward: BigInt(p.reward),
    minimumDiscrepancy: BigInt(p.minimumDiscrepancy),
    submissionDeadline: BigInt(p.submissionDeadline),
    settlementDeadline: BigInt(p.settlementDeadline),
    reservationDurationSeconds: Number(p.reservationDurationSeconds),
  };
}
