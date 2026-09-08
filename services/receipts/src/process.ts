import type { Pool } from "pg";
import type { Hex } from "viem";
import type { FundingReceipt } from "../../../packages/chain/src/funding.ts";
import { hashCanonical } from "../../../packages/crypto-envelope/src/index.ts";
import { DomainError } from "../../../packages/domain/src/index.ts";
import { first } from "../../api/src/context.ts";
import { contentHash, exportSnapshotSchema, receiptCsv, verifyExportRecord } from "./records.ts";
export type ExportChain = { finalReceipt(hash: Hex): Promise<FundingReceipt | null> };
export async function processReceiptExport(pool: Pool, chain: ExportChain, exportId: string) {
  const c = await pool.connect(),
    lock = `receipt-export:${exportId}`;
  let locked = false;
  try {
    locked = (
      await c.query("select pg_try_advisory_lock(hashtextextended($1,0)) as locked", [lock])
    ).rows[0].locked;
    if (!locked) return;
    const row = await first(c, "select * from receipt_exports where id=$1", [exportId]);
    if (["READY", "FAILED", "CANCELLED"].includes(row.state)) return;
    const authorized = async () =>
      row.organization_id === null ||
      (
        await c.query(
          "select 1 from memberships where organization_id=$1 and user_id=$2 and status='ACTIVE' and role in ('OWNER','TREASURY')",
          [row.organization_id, row.requested_by],
        )
      ).rowCount === 1;
    if (!(await authorized())) {
      await c.query(
        "update receipt_exports set state='CANCELLED',error_code='MEMBERSHIP_REMOVED' where id=$1",
        [exportId],
      );
      return;
    }
    await c.query(
      "update receipt_exports set state='RUNNING',attempts=attempts+1,updated_at=now() where id=$1",
      [exportId],
    );
    try {
      const snapshot = exportSnapshotSchema.parse(row.snapshot_json);
      if (
        snapshot.organizationId !== row.organization_id ||
        snapshot.requestedBy !== row.requested_by ||
        hashCanonical(snapshot) !== row.input_hash
      )
        throw new DomainError("EXPORT_SNAPSHOT_MISMATCH", "The saved export needs review.");
      const receipts = new Map<Hex, Promise<FundingReceipt | null>>();
      for (let i = 0; i < snapshot.records.length; i += 4) {
        await Promise.all(
          snapshot.records.slice(i, i + 4).map(async (record) => {
            let pending = receipts.get(record.transactionHash);
            if (!pending) {
              pending = chain.finalReceipt(record.transactionHash);
              receipts.set(record.transactionHash, pending);
            }
            const receipt = await pending;
            if (!receipt)
              throw new DomainError(
                "EXPORT_NOT_FINAL",
                "A receipt needs another finality check.",
                503,
              );
            verifyExportRecord(record, receipt);
          }),
        );
      }
      if (!(await authorized())) {
        await c.query(
          "update receipt_exports set state='CANCELLED',error_code='MEMBERSHIP_REMOVED' where id=$1",
          [exportId],
        );
        return;
      }
      const csv = receiptCsv(snapshot.records);
      await c.query(
        "update receipt_exports set state='READY',csv=$2,content_hash=$3,completed_at=now(),error_code=null,version=version+1,updated_at=now() where id=$1",
        [exportId, csv, contentHash(csv)],
      );
    } catch (error) {
      const invalid = error instanceof DomainError && error.status !== 503;
      await c.query(
        "update receipt_exports set state=$2,error_code=$3,updated_at=now() where id=$1",
        [
          exportId,
          invalid || row.attempts >= 4 ? "FAILED" : "RETRYING",
          error instanceof DomainError ? error.code : "EXPORT_CHECK_UNAVAILABLE",
        ],
      );
    }
  } finally {
    if (locked) await c.query("select pg_advisory_unlock(hashtextextended($1,0))", [lock]);
    c.release();
  }
}
