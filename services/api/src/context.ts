import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { z } from "zod";
import { DomainError } from "../../../packages/domain/src/index.ts";
import { headerSchemas, pathSchemas } from "./request-schemas.ts";

export type Actor = { id: string; displayName: string };
declare module "fastify" {
  interface FastifyRequest {
    actor: Actor;
  }
}
export type Connection = Pick<PoolClient, "query">;
export async function first<T extends QueryResultRow>(
  connection: Connection,
  statement: string,
  values: unknown[] = [],
): Promise<T> {
  const result = await connection.query<T>(statement, values);
  if (!result.rows[0]) throw new DomainError("NOT_FOUND", "This resource is not available.", 404);
  return result.rows[0];
}
export async function member(
  connection: Connection,
  actor: Actor,
  organizationId: string,
  roles?: string[],
) {
  const membership = await first<{ role: string }>(
    connection,
    "select role from memberships where organization_id=$1 and user_id=$2 and status='ACTIVE'",
    [organizationId, actor.id],
  );
  if (roles && !roles.includes(membership.role))
    throw new DomainError("FORBIDDEN", "Your role cannot perform this action.", 403);
  return membership;
}
export function expectedVersion(request: FastifyRequest): number {
  const value = request.headers["if-match"];
  if (!headerSchemas.version.safeParse(value).success)
    throw new DomainError(
      "VERSION_REQUIRED",
      "Send the current resource version in If-Match.",
      400,
    );
  const version = Number(String(value).replaceAll('"', ""));
  if (!Number.isSafeInteger(version))
    throw new DomainError("VERSION_REQUIRED", "Resource version is invalid.", 400);
  return version;
}
export const idParams = (request: FastifyRequest) => pathSchemas.uuid.parse(request.params);
export const pageParams = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.uuid().optional(),
});

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export async function mutate<T extends Record<string, unknown>>(
  pool: Pool,
  request: FastifyRequest,
  authorize: (c: PoolClient) => Promise<unknown>,
  execute: (c: PoolClient) => Promise<{ status: number; body: T }>,
): Promise<{ status: number; body: T }> {
  const key = headerSchemas.idempotency.parse(request.headers["idempotency-key"]);
  const route = `${request.method}:${request.url.split("?")[0]}`;
  const requestHash = createHash("sha256")
    .update(
      stableJson({ body: request.body ?? null, version: request.headers["if-match"] ?? null }),
    )
    .digest("hex");
  const c = await pool.connect();
  try {
    await c.query("begin");
    // Serialize duplicate retries before any state change or response is made.
    await c.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
      `${request.actor.id}:${route}:${key}`,
    ]);
    await authorize(c);
    const prior = await c.query(
      "select * from idempotency_records where actor_id=$1 and route=$2 and key=$3",
      [request.actor.id, route, key],
    );
    if (prior.rows[0]) {
      if (prior.rows[0].request_hash !== requestHash)
        throw new DomainError("IDEMPOTENCY_CONFLICT", "Use a new request key for changed input.");
      await c.query("commit");
      return prior.rows[0].response_json;
    }
    const result = await execute(c);
    await c.query(
      "insert into idempotency_records(actor_id,route,key,request_hash,response_json,expires_at) values($1,$2,$3,$4,$5,now()+interval '24 hours')",
      [request.actor.id, route, key, requestHash, JSON.stringify(result)],
    );
    await c.query(
      "insert into audit_events(actor_id,action,resource_id,result_code,request_id) values($1,$2,$3,'OK',$4)",
      [request.actor.id, request.method, route, request.id],
    );
    await c.query("commit");
    return result;
  } catch (error) {
    await c.query("rollback");
    throw error;
  } finally {
    c.release();
  }
}
