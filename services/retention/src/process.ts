import { sep } from "node:path";
import type { Pool } from "pg";
import { ciphertextLock } from "../../../packages/ciphertext-store/src/coordination.ts";
import type { ManagedCiphertextStore } from "../../../packages/ciphertext-store/src/index.ts";

export async function sweepRetention(
  pool: Pool,
  stores: {
    evidence: ManagedCiphertextStore;
    reports: ManagedCiphertextStore;
  },
) {
  const c = await pool.connect();
  let locked = false;
  const result = {
    state: "COMPLETE",
    evidenceDeleted: 0,
    reportsDeleted: 0,
    orphansDeleted: 0,
    restoredObjectsDeleted: 0,
    checkedRows: 0,
  };
  try {
    locked = (
      await c.query("select pg_try_advisory_lock(hashtextextended($1,0)) as locked", [
        ciphertextLock,
      ])
    ).rows[0].locked;
    if (!locked) return { ...result, state: "BUSY" };
    const [evidenceRoot, reportRoot] = await Promise.all([
      stores.evidence.location(),
      stores.reports.location(),
    ]);
    if (
      evidenceRoot === reportRoot ||
      evidenceRoot.startsWith(`${reportRoot}${sep}`) ||
      reportRoot.startsWith(`${evidenceRoot}${sep}`)
    )
      throw new Error("Evidence and report storage must use separate directories.");
    await c.query(`update uploads u set delete_after=c.updated_at+interval '7 days'
      from claims c where c.upload_id=u.id and u.state='UPLOADED' and u.delete_after is null
      and c.job_state in ('SETTLED','INVALID_FIXTURE','EXPIRED')
      and not exists(select 1 from reports r where r.claim_id=c.claim_id and r.retention_hold)`);
    for (const table of ["uploads", "reports"] as const) {
      const due =
        table === "reports"
          ? "(state='DELETING' or (state<>'DELETED' and not retention_hold and delete_after<=now()))"
          : "(state='DELETING' or (state<>'DELETED' and delete_after<=now()))";
      const objectColumns =
        table === "uploads"
          ? "object_key,null::text as secondary_key"
          : "ciphertext_object_key as object_key,researcher_object_key as secondary_key";
      let cursor: string | null = null;
      while (true) {
        const rows: { id: string }[] = (
          await c.query(
            `select id from ${table} where ${due} and ($1::uuid is null or id>$1) order by id limit 100`,
            [cursor],
          )
        ).rows;
        if (!rows.length) break;
        for (const candidate of rows) {
          result.checkedRows++;
          cursor = candidate.id;
          await c.query("begin");
          let row:
            | { id: string; state: string; object_key: string; secondary_key: string | null }
            | undefined;
          try {
            row = (
              await c.query(
                `select id,state,${objectColumns} from ${table} where id=$1 and ${due} for update`,
                [candidate.id],
              )
            ).rows[0];
            if (row && !["DELETING", "DELETED"].includes(row.state)) {
              await c.query(`update ${table} set state='DELETING',updated_at=now() where id=$1`, [
                row.id,
              ]);
              if (table === "uploads")
                await c.query(
                  "update claims set job_state='EXPIRED',updated_at=now() where upload_id=$1 and job_state='UPLOADING'",
                  [row.id],
                );
            }
            await c.query("commit");
          } catch (error) {
            await c.query("rollback");
            throw error;
          }
          if (!row) continue;
          const store = table === "uploads" ? stores.evidence : stores.reports;
          await store.remove(row.object_key);
          if (row.secondary_key) await store.remove(row.secondary_key);
          if (row.state !== "DELETED") {
            await c.query(
              `update ${table} set state='DELETED',deleted_at=coalesce(deleted_at,now()),updated_at=now() where id=$1`,
              [row.id],
            );
            if (table === "uploads") result.evidenceDeleted++;
            else result.reportsDeleted++;
          }
        }
      }
    }
    const cutoff = new Date(
      (await c.query("select now()-interval '24 hours' as cutoff")).rows[0].cutoff,
    );
    for (const [kind, store] of Object.entries(stores)) {
      for await (const object of store.inventory()) {
        if (object.kind === "pending") {
          if (object.modifiedAt > cutoff) continue;
          await store.removePending(object.id);
          result.orphansDeleted++;
          continue;
        }
        const known =
          kind === "evidence"
            ? await c.query("select id,state from uploads where object_key=$1 limit 1", [object.id])
            : await c.query(
                "select id,state from reports where ciphertext_object_key=$1 or researcher_object_key=$1 limit 1",
                [object.id],
              );
        if (known.rows[0]?.state === "DELETED") {
          await store.remove(object.id);
          result.restoredObjectsDeleted++;
        } else if (!known.rowCount && object.modifiedAt <= cutoff) {
          await store.remove(object.id);
          result.orphansDeleted++;
        }
      }
    }
    return result;
  } finally {
    try {
      if (locked)
        await c.query("select pg_advisory_unlock(hashtextextended($1,0))", [ciphertextLock]);
    } finally {
      c.release();
    }
  }
}
