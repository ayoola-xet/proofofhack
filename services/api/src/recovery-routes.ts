import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { RecoveryChain } from "../../../packages/chain/src/recovery.ts";
import { DomainError } from "../../../packages/domain/src/index.ts";
import { reconcileRecovery } from "../../worker/src/recovery-receipt.ts";
import { first, idParams, member, mutate } from "./context.ts";
import { parseApiBody } from "./parse-body.ts";
import { hashPageParams, pathSchemas } from "./request-schemas.ts";

export function registerRecoveryRoutes(app: FastifyInstance, pool: Pool, chain?: RecoveryChain) {
  app.get("/api/v1/organizations/:id/recovery", async (request) => {
    const { id } = idParams(request);
    await member(pool, request.actor, id, ["OWNER", "TREASURY"]);
    const page = hashPageParams.parse(request.query);
    const rows = (
      await pool.query(
        `select b.bounty_id,b.reward,b.chain_state,b.policy_json->>'settlementDeadline' as settlement_deadline,
       b.policy_json->>'refundRecipient' as refund_recipient,coalesce(r.status,'NOT_STARTED') as status,
       r.failure_code,r.checkpoint_block,r.next_check_at,r.updated_at,i.transaction_hash,i.state as transaction_state
       from bounties b join programs p on p.id=b.program_id left join bounty_recovery r on r.bounty_id=b.bounty_id
       left join lateral(select transaction_hash,state from transaction_intents where purpose in('RECOVERY_expireReservation','RECOVERY_refundExpired')
       and request_json->>'bountyId'=b.bounty_id order by created_at desc limit 1)i on true
       where p.organization_id=$1 and ($2::text is null or b.bounty_id>$2) order by b.bounty_id limit $3`,
        [id, page.cursor ?? null, page.limit + 1],
      )
    ).rows;
    return {
      items: rows.slice(0, page.limit),
      nextCursor: rows.length > page.limit ? rows[page.limit - 1].bounty_id : null,
    };
  });
  app.post("/api/v1/bounties/:id/recovery/retry", async (request, reply) => {
    const { id } = pathSchemas.hash.parse(request.params);
    parseApiBody("empty", request);
    const result = await mutate(
      pool,
      request,
      async (c) => {
        const bounty = await first(
          c,
          "select p.organization_id from bounties b join programs p on p.id=b.program_id where b.bounty_id=$1",
          [id],
        );
        await member(c, request.actor, bounty.organization_id, ["OWNER", "TREASURY"]);
      },
      async (c) => {
        if (!chain)
          throw new DomainError(
            "SERVICE_NOT_CONFIGURED",
            "Recovery needs chain configuration.",
            503,
          );
        if (
          !(
            await c.query("select pg_try_advisory_xact_lock(hashtextextended($1,0)) as locked", [
              `claim-lifecycle:${id}`,
            ])
          ).rows[0].locked
        )
          throw new DomainError(
            "RECOVERY_BUSY",
            "A claim or recovery check is active. Retry later.",
            503,
          );
        await c.query(
          "insert into bounty_recovery(bounty_id,status) values($1,'WAITING') on conflict(bounty_id) do update set status='WAITING',failure_code=null,next_check_at=now(),updated_at=now()",
          [id],
        );
        await c.query(
          "insert into outbox(deduplication_key,event_type,aggregate_id,payload_json) values($1,'RECOVERY_PROCESS',$2,$3)",
          [`recovery-retry:${request.id}`, id, JSON.stringify({ bountyId: id })],
        );
        return { status: 202, body: { bountyId: id, status: "QUEUED" } };
      },
    );
    return reply.code(result.status).send(result.body);
  });
  app.post("/api/v1/bounties/:id/recovery-receipts", async (request, reply) => {
    const { id } = pathSchemas.hash.parse(request.params);
    const { transactionHash } = parseApiBody("transactionHash", request);
    const result = await mutate(
      pool,
      request,
      async (c) => {
        const bounty = await first(
          c,
          "select p.organization_id from bounties b join programs p on p.id=b.program_id where b.bounty_id=$1",
          [id],
        );
        await member(c, request.actor, bounty.organization_id, ["OWNER", "TREASURY"]);
      },
      async (c) => {
        if (!chain)
          throw new DomainError(
            "SERVICE_NOT_CONFIGURED",
            "Recovery needs chain configuration.",
            503,
          );
        return { status: 200, body: await reconcileRecovery(c, chain, id, transactionHash) };
      },
    );
    return reply.code(result.status).send(result.body);
  });
}
