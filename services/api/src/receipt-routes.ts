import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { ARC_USDC } from "../../../packages/chain/src/arc.ts";
import { hashCanonical } from "../../../packages/crypto-envelope/src/index.ts";
import { DomainError } from "../../../packages/domain/src/index.ts";
import {
  contentHash,
  exportRecordSchema,
  exportSnapshotSchema,
  filtersSchema,
} from "../../receipts/src/records.ts";
import { first, idParams, member, mutate, pageParams } from "./context.ts";
import { parseApiBody } from "./parse-body.ts";

type ExportRow = {
  id: string;
  state: string;
  error_code: string | null;
  content_hash: string | null;
  snapshot_json: { records: unknown[] };
  created_at: Date;
  completed_at: Date | null;

  csv: string | null;
  organization_id: string | null;
};
export function registerReceiptRoutes(app: FastifyInstance, pool: Pool) {
  for (const scope of ["organization", "researcher"] as const) {
    const base = scope === "organization" ? "/api/v1/organizations/:id" : "/api/v1/me";
    app.get(`${base}/receipts`, async (request) => {
      const id = scope === "organization" ? idParams(request).id : null;
      if (id) await member(pool, request.actor, id, ["OWNER", "TREASURY"]);
      const page = pageParams.parse(request.query),
        filters = filtersSchema.parse(
          Object.fromEntries(
            Object.entries(request.query as Record<string, unknown>).filter(
              ([key]) => !["limit", "cursor"].includes(key),
            ),
          ),
        );
      const rows = (
        await pool.query(
          `select r.*,e.transaction_hash,e.block_number,e.block_hash,e.log_index,e.chain_id,e.finality_state
      from receipts r join chain_events e on e.id=r.event_id where (($1::uuid is not null and r.organization_id=$1) or ($1::uuid is null and r.claimant_user_id=$7 and r.category='PAYMENT'))
      and ($2::uuid is null or r.id>$2) and ($3::text is null or r.category=$3)
      and ($4::timestamptz is null or r.created_at >= $4) and ($5::timestamptz is null or r.created_at < $5)
      order by r.id limit $6`,
          [
            id,
            page.cursor ?? null,
            filters.category ?? null,
            filters.from ?? null,
            filters.to ?? null,
            page.limit + 1,
            request.actor.id,
          ],
        )
      ).rows;
      return {
        items: rows.slice(0, page.limit),
        nextCursor: rows.length > page.limit ? rows[page.limit - 1].id : null,
      };
    });
    app.post(`${base}/receipt-exports`, async (request, reply) => {
      const id = scope === "organization" ? idParams(request).id : null,
        filters = parseApiBody("receiptFilters", request);
      const result = await mutate(
        pool,
        request,
        async (c) => (id ? member(c, request.actor, id, ["OWNER", "TREASURY"]) : undefined),
        async (c) => {
          const rows = (
            await c.query(
              `select r.*,e.chain_id,e.contract_address,e.transaction_hash,e.block_number,e.block_hash,e.log_index,e.name,e.payload_json,
        p.organization_id as bounty_organization,b.escrow as bounty_escrow,
        exists(select 1 from claims cl where cl.claim_id=e.payload_json->>'claimId' and cl.bounty_id=r.bounty_id and cl.researcher_user_id=r.claimant_user_id and cl.claimant_address=e.payload_json->>'claimant') as known_claimant,
        exists(select 1 from budget_controllers bc join wallets ow on ow.id=bc.owner_wallet_id where bc.organization_id=r.organization_id and bc.asset=r.asset and
          ((r.category='BUDGET_DEPOSIT' and bc.address=e.payload_json->>'to' and ow.address=e.payload_json->>'from') or
           (r.category='BUDGET_WITHDRAW' and bc.address=e.contract_address and ow.address=e.payload_json->>'recipient') or (r.category='BUDGET_ALLOCATION' and bc.address=e.contract_address))) as known_controller
        from receipts r join chain_events e on e.id=r.event_id left join bounties b on b.bounty_id=r.bounty_id left join programs p on p.id=b.program_id
        where (($1::uuid is not null and r.organization_id=$1) or ($1::uuid is null and r.claimant_user_id=$5 and r.category='PAYMENT')) and r.status='FINAL' and e.finality_state='FINAL'
        and ($2::text is null or r.category=$2) and ($3::timestamptz is null or r.created_at >= $3) and ($4::timestamptz is null or r.created_at < $4)
        order by r.created_at,r.id limit 1001`,
              [
                id,
                filters.category ?? null,
                filters.from ?? null,
                filters.to ?? null,
                request.actor.id,
              ],
            )
          ).rows;
          if (rows.length > 1000)
            throw new DomainError(
              "EXPORT_TOO_LARGE",
              "Select filters for at most 1,000 receipts.",
              400,
            );
          const records = rows.map((r) => {
            if (
              r.asset !== ARC_USDC ||
              (scope === "researcher" && !r.known_claimant) ||
              (!["BUDGET_DEPOSIT", "BUDGET_WITHDRAW"].includes(r.category) && !r.bounty_id) ||
              (r.bounty_id &&
                (r.bounty_organization !== r.organization_id ||
                  (r.category !== "BUDGET_ALLOCATION" &&
                    r.contract_address !== r.bounty_escrow))) ||
              (r.category.startsWith("BUDGET_") && !r.known_controller)
            )
              throw new DomainError("EXPORT_SCOPE_MISMATCH", "A receipt binding needs review.");
            return exportRecordSchema.parse({
              id: r.id,
              category: r.category,
              amount: r.amount,
              asset: r.asset,
              chainId: r.chain_id,
              bountyId: r.bounty_id,
              recordedAt: r.created_at.toISOString(),
              eventId: r.event_id,
              eventName: r.name,
              contract: r.contract_address,
              transactionHash: r.transaction_hash,
              blockNumber: r.block_number,
              blockHash: r.block_hash,
              logIndex: String(r.log_index),
              payload: r.payload_json,
            });
          });
          const snapshot = exportSnapshotSchema.parse({
            version: scope === "organization" ? "1" : "2",
            organizationId: id,
            requestedBy: request.actor.id,
            filters,
            records,
          });
          const row = await first(
            c,
            "insert into receipt_exports(organization_id,requested_by,snapshot_json,input_hash) values($1,$2,$3,$4) returning id,state,created_at",
            [id, request.actor.id, JSON.stringify(snapshot), hashCanonical(snapshot)],
          );
          return { status: 202, body: { ...row, rowCount: records.length } };
        },
      );
      return reply.code(result.status).send(result.body);
    });
    app.get(`${base}/receipt-exports`, async (request) => {
      const id = scope === "organization" ? idParams(request).id : null;
      if (id) await member(pool, request.actor, id, ["OWNER", "TREASURY"]);
      const rows = (
        await pool.query(
          "select * from receipt_exports where organization_id is not distinct from $1::uuid and requested_by=$2 order by created_at desc limit 20",
          [id, request.actor.id],
        )
      ).rows;
      return { items: rows.map(metadata) };
    });
  }
  async function owned(id: string, actor: { id: string; displayName: string }) {
    const row = await first<ExportRow>(
      pool,
      "select * from receipt_exports where id=$1 and requested_by=$2",
      [id, actor.id],
    );
    if (row.organization_id) await member(pool, actor, row.organization_id, ["OWNER", "TREASURY"]);
    return row;
  }
  const metadata = (row: ExportRow) => ({
    id: row.id,
    state: row.state,
    errorCode: row.error_code,
    contentHash: row.content_hash,
    rowCount: row.snapshot_json.records.length,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  });
  app.get("/api/v1/exports/:id/status", async (request) =>
    metadata(await owned(idParams(request).id, request.actor)),
  );
  app.get("/api/v1/exports/:id", async (request, reply) => {
    const row = await owned(idParams(request).id, request.actor);
    if (row.state !== "READY") return reply.code(202).send(metadata(row));
    if (typeof row.csv !== "string" || contentHash(row.csv) !== row.content_hash)
      throw new DomainError("EXPORT_INTEGRITY", "The export failed its integrity check.", 503);
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="vulnproof-receipts-${row.id}.csv"`)
      .header("x-content-sha256", row.content_hash)
      .send(row.csv);
  });
}
