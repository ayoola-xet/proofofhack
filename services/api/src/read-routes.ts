import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { bytes32 } from "../../../packages/domain/src/index.ts";
import { first, idParams, member, pageParams } from "./context.ts";

export function registerReadRoutes(app: FastifyInstance, pool: Pool) {
  app.get("/api/v1/bounties", async (request) => {
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(25),
        cursor: bytes32.optional(),
      })
      .parse(request.query);
    const rows = (
      await pool.query(
        "select bounty_id, reward, chain_state, policy_json as policy, chain_id, escrow, version from bounties where ($1::text is null or bounty_id>$1) order by bounty_id limit $2",
        [query.cursor ?? null, query.limit + 1],
      )
    ).rows;
    return {
      items: rows.slice(0, query.limit),
      nextCursor: rows.length > query.limit ? rows[query.limit - 1].bounty_id : null,
    };
  });
  app.get("/api/v1/bounties/:id", async (request) => {
    const { id } = z.object({ id: bytes32 }).parse(request.params);
    return first(
      pool,
      "select bounty_id,reward,unallocated_reward,claimant_credit,chain_state,policy_json as policy,chain_id,escrow,creation_tx,version from bounties where bounty_id=$1",
      [id],
    );
  });
  app.get("/api/v1/organizations/:id/coverage", async (request) => {
    const { id } = idParams(request);
    await member(pool, request.actor, id);
    const page = pageParams.parse(request.query);
    const rows = (
      await pool.query(
        `select v.id,v.label,v.address,v.source_chain_id,c.status,c.reason,c.funded_reward,o.observed_at,o.provider_deployment_id,o.observed_block,o.indexed_head,o.read_status from registered_vaults v left join lateral(select * from coverage_records where vault_id=v.id order by computed_at desc limit 1)c on true left join vault_observations o on o.id=c.source_observation_id where v.organization_id=$1 and ($2::uuid is null or v.id>$2) order by v.id limit $3`,
        [id, page.cursor ?? null, page.limit + 1],
      )
    ).rows;
    return {
      items: rows.slice(0, page.limit),
      nextCursor: rows.length > page.limit ? rows[page.limit - 1].id : null,
    };
  });
  app.get("/api/v1/organizations/:id/reports", async (request) => {
    const { id } = idParams(request);
    await member(pool, request.actor, id, ["OWNER", "REVIEWER"]);
    const page = pageParams.parse(request.query);
    const rows = (
      await pool.query(
        `select r.id,r.state,r.report_hash,r.available_at from reports r join claims c on c.claim_id=r.claim_id join bounties b on b.bounty_id=c.bounty_id join programs p on p.id=b.program_id where p.organization_id=$1 and ($2::uuid is null or r.id>$2) order by r.id limit $3`,
        [id, page.cursor ?? null, page.limit + 1],
      )
    ).rows;
    return {
      items: rows.slice(0, page.limit),
      nextCursor: rows.length > page.limit ? rows[page.limit - 1].id : null,
    };
  });
  app.get("/api/v1/wallets/me", async (request) => ({
    items: (
      await pool.query(
        "select id,provider,address,chain_id,version from wallets where owner_type='USER' and owner_id=$1",
        [request.actor.id],
      )
    ).rows,
  }));
}
