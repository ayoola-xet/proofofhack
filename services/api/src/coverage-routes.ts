import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { DomainError } from "../../../packages/domain/src/index.ts";
import sources from "../../../packages/erc4626-coverage-data/sources.json";
import { first, idParams, member, mutate } from "./context.ts";
import { parseApiBody } from "./parse-body.ts";

export function registerCoverageRoutes(app: FastifyInstance, pool: Pool) {
  app.get("/api/v1/coverage/sources", async () => ({
    items: sources.map((s) => ({
      id: `${s.chainId}:${s.address}`,
      chainId: s.chainId,
      address: s.address,
      label: s.label,
      synthetic: s.synthetic,
      source: s.source,
    })),
  }));
  app.post("/api/v1/organizations/:id/vaults", async (request, reply) => {
    const { id } = idParams(request);
    const input = parseApiBody("vault", request);
    const source = sources.find((s) => `${s.chainId}:${s.address}` === input.sourceId);
    if (!source)
      throw new DomainError("UNSUPPORTED_SOURCE", "Select a configured source vault.", 400);
    const result = await mutate(
      pool,
      request,
      async (c) => {
        await c.query("select id from organizations where id=$1 for update", [id]);
        await member(c, request.actor, id, ["OWNER", "REVIEWER"]);
      },
      async (c) => {
        const vault = await first(
          c,
          "insert into registered_vaults(organization_id,source_chain_id,address,label,fixture_scope) values($1,$2,$3,$4,false) returning *",
          [id, source.chainId, source.address, source.label],
        );
        await c.query(
          "insert into outbox(deduplication_key,event_type,aggregate_id,payload_json) values($1,'COVERAGE_REFRESH',$2,$3)",
          [`vault:${vault.id}`, id, JSON.stringify({ organizationId: id })],
        );
        return { status: 201, body: vault };
      },
    );
    return reply.code(result.status).send(result.body);
  });
  app.get("/api/v1/organizations/:id/coverage-policies", async (request) => {
    const { id } = idParams(request);
    await member(pool, request.actor, id);
    return {
      items: (
        await pool.query(
          "select * from coverage_policies where organization_id=$1 order by version_number desc limit 100",
          [id],
        )
      ).rows,
    };
  });
  app.post("/api/v1/organizations/:id/coverage/refresh", async (request, reply) => {
    const { id } = idParams(request);
    parseApiBody("empty", request);
    const result = await mutate(
      pool,
      request,
      (c) => member(c, request.actor, id),
      async (c) => {
        const job = await first(
          c,
          "insert into outbox(deduplication_key,event_type,aggregate_id,payload_json) values($1,'COVERAGE_REFRESH',$2,$3) returning id",
          [`refresh:${request.id}`, id, JSON.stringify({ organizationId: id })],
        );
        return { status: 202, body: { id: job.id, state: "QUEUED" } };
      },
    );
    return reply.code(result.status).send(result.body);
  });
  app.get("/api/v1/organizations/:id/recommendations", async (request) => {
    const { id } = idParams(request);
    await member(pool, request.actor, id);
    const rows = (
      await pool.query(
        `select id,source_ids,policy_id,calculation_json,explanation,
      case when expires_at>now() then action_json else null end as action_json,
      expires_at,case when expires_at>now() then status else 'EXPIRED' end as status,created_at
      from recommendations where organization_id=$1 order by created_at desc limit 25`,
        [id],
      )
    ).rows;
    return { items: rows };
  });
  app.get("/api/v1/recommendations/:id", async (request) => {
    const { id } = idParams(request);
    const row = await first(
      pool,
      `select *,case when expires_at>now() then status else 'EXPIRED' end as status,
      case when expires_at>now() then action_json else null end as action_json from recommendations where id=$1`,
      [id],
    );
    await member(pool, request.actor, row.organization_id);
    return row;
  });
}
