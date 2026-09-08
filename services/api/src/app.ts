import { randomUUID } from "node:crypto";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import type { RecoveryChain } from "../../../packages/chain/src/recovery.ts";
import { DomainError, organizationHash } from "../../../packages/domain/src/index.ts";
import type { WalletIdentityProvider } from "../../../packages/privy/src/wallets.ts";
import { registerAssistantRoutes } from "./assistant-routes.ts";
import type { AuthProvider } from "./auth.ts";
import { type BountyServices, registerBountyRoutes } from "./bounty-routes.ts";
import { type BudgetServices, registerBudgetRoutes } from "./budget-routes.ts";
import { type ClaimServices, registerClaimRoutes } from "./claim-routes.ts";
import { expectedVersion, first, idParams, member, mutate, pageParams } from "./context.ts";
import { registerCoverageRoutes } from "./coverage-routes.ts";
import { registerFundingRoutes } from "./funding-routes.ts";
import { registerOwnerRoutes } from "./owner-routes.ts";
import { parseApiBody } from "./parse-body.ts";
import { registerReadRoutes } from "./read-routes.ts";
import { registerReceiptRoutes } from "./receipt-routes.ts";
import { registerRecoveryRoutes } from "./recovery-routes.ts";
import { pathSchemas } from "./request-schemas.ts";
import { registerRpcRoutes } from "./rpc-routes.ts";
import { registerTreasuryRoutes } from "./treasury-routes.ts";
import { registerWalletRoutes } from "./wallet-routes.ts";

export type ApiOptions = {
  onRoute?: (route: { method: string | string[]; url: string }) => void;
  pool: Pool;
  auth: AuthProvider;
  appEnv: "local" | "arc-testnet";
  webOrigin: string;
  walletIdentity?: WalletIdentityProvider;
  bountyServices?: BountyServices;
  claimServices?: ClaimServices;
  assistantModel?: string;
  budgetServices?: BudgetServices;
  recoveryChain?: RecoveryChain;
};
export async function createApp(options: ApiOptions) {
  const { pool } = options;
  const app = Fastify({
    bodyLimit: 300_000,
    logger: false,
    genReqId: () => randomUUID(),
    trustProxy: false,
  });
  if (options.onRoute) app.addHook("onRoute", options.onRoute);
  await app.register(cors, {
    origin: options.webOrigin,
    methods: ["GET", "POST", "PATCH", "PUT"],
    allowedHeaders: ["Authorization", "Content-Type", "Idempotency-Key", "If-Match"],
  });
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  app.decorateRequest("actor");
  app.addHook("onRequest", async (request, reply) => {
    reply
      .header("Cache-Control", "no-store")
      .header("X-Content-Type-Options", "nosniff")
      .header("X-Request-Id", request.id);
    if (
      request.method === "OPTIONS" ||
      ["/api/v1/health", "/api/v1/rpc/arc"].includes(request.url.split("?")[0])
    )
      return;
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ") || header.length > 8192)
      throw new DomainError("UNAUTHENTICATED", "Sign in to continue.", 401);
    const identity = await options.auth.verify(header.slice(7));
    const user = await first<{ id: string; display_name: string }>(
      pool,
      "insert into users(privy_user_id,display_name) values($1,$2) on conflict(privy_user_id) do update set privy_user_id=excluded.privy_user_id returning id,display_name",
      [identity.subject, identity.displayName],
    );
    request.actor = { id: user.id, displayName: user.display_name };
  });
  app.setErrorHandler((error: Error & { code?: string; statusCode?: number }, request, reply) => {
    const domain =
      error instanceof DomainError
        ? error
        : error instanceof z.ZodError
          ? new DomainError("INVALID_INPUT", "Check the request fields.", 400)
          : error.code === "23505"
            ? new DomainError("RESOURCE_CONFLICT", "This resource already exists.")
            : error.statusCode && error.statusCode >= 400 && error.statusCode < 500
              ? new DomainError(
                  "INVALID_REQUEST",
                  "Check the request format and size.",
                  error.statusCode,
                )
              : new DomainError("SERVICE_ERROR", "The service cannot complete this request.", 503);
    reply.code(domain.status).send({
      error: {
        code: domain.code,
        message: domain.message,
        requestId: request.id,
        retryable: domain.status === 503 || domain.status === 429,
      },
    });
  });
  app.get("/api/v1/health", async () => ({ status: "available", environment: options.appEnv }));
  app.get("/api/v1/me", async (request) => ({
    user: request.actor,
    memberships: (
      await pool.query(
        "select m.organization_id, m.role, m.version, o.name from memberships m join organizations o on o.id=m.organization_id where m.user_id=$1 and m.status='ACTIVE' order by o.name",
        [request.actor.id],
      )
    ).rows,
    wallets: (
      await pool.query(
        "select id,provider,chain_id,address from wallets where owner_type='USER' and owner_id=$1",
        [request.actor.id],
      )
    ).rows,
  }));

  app.post("/api/v1/organizations", async (request, reply) => {
    const input = parseApiBody("organization", request);
    const result = await mutate(
      pool,
      request,
      async () => {},
      async (c) => {
        const id = randomUUID();
        const org = await first(
          c,
          "insert into organizations(id,onchain_id,name,owner_user_id) values($1,$2,$3,$4) returning *",
          [id, organizationHash(id), input.name, request.actor.id],
        );
        await c.query(
          "insert into memberships(organization_id,user_id,role) values($1,$2,'OWNER')",
          [id, request.actor.id],
        );
        return { status: 201, body: org };
      },
    );
    return reply.code(result.status).send(result.body);
  });
  app.get("/api/v1/organizations/:id", async (request) => {
    const { id } = idParams(request);
    await member(pool, request.actor, id);
    const org = await first(
      pool,
      "select id,onchain_id,name,status,version from organizations where id=$1",
      [id],
    );
    return {
      ...org,
      members: (
        await pool.query(
          "select m.user_id,m.role,m.status,m.version,u.display_name from memberships m join users u on u.id=m.user_id where organization_id=$1 order by u.display_name",
          [id],
        )
      ).rows,
    };
  });
  app.post("/api/v1/organizations/:id/members", async (request, reply) => {
    const { id } = idParams(request);
    const input = parseApiBody("member", request);
    const result = await mutate(
      pool,
      request,
      async (c) => {
        await c.query("select id from organizations where id=$1 for update", [id]);
        await member(c, request.actor, id, ["OWNER"]);
      },
      async (c) => {
        await first(c, "select id from users where id=$1", [input.userId]);
        return {
          status: 201,
          body: await first(
            c,
            "insert into memberships(organization_id,user_id,role) values($1,$2,$3) returning *",
            [id, input.userId, input.role],
          ),
        };
      },
    );
    return reply.code(result.status).send(result.body);
  });
  app.patch("/api/v1/organizations/:id/members/:userId", async (request, reply) => {
    const { id, userId } = pathSchemas.member.parse(request.params);
    const input = parseApiBody("memberUpdate", request);
    const version = expectedVersion(request);
    const result = await mutate(
      pool,
      request,
      async (c) => {
        await c.query("select id from organizations where id=$1 for update", [id]);
        await member(c, request.actor, id, ["OWNER"]);
      },
      async (c) => {
        const current = await first(
          c,
          "select * from memberships where organization_id=$1 and user_id=$2 for update",
          [id, userId],
        );
        if (current.version !== version)
          throw new DomainError("STALE_RESOURCE", "Reload the current resource.");
        if (
          current.role === "OWNER" &&
          current.status === "ACTIVE" &&
          ((input.role && input.role !== "OWNER") || input.status === "DISABLED")
        ) {
          const count = await first(
            c,
            "select count(*)::int as total from memberships where organization_id=$1 and role='OWNER' and status='ACTIVE'",
            [id],
          );
          if (count.total <= 1)
            throw new DomainError("LAST_OWNER", "Keep at least one active owner.");
        }
        return {
          status: 200,
          body: await first(
            c,
            "update memberships set role=coalesce($3,role),status=coalesce($4,status),version=version+1,updated_at=now() where organization_id=$1 and user_id=$2 returning *",
            [id, userId, input.role ?? null, input.status ?? null],
          ),
        };
      },
    );
    return reply.code(result.status).send(result.body);
  });

  app.post("/api/v1/organizations/:id/coverage-policies", async (request, reply) => {
    const { id } = idParams(request);
    const input = parseApiBody("coveragePolicy", request);
    const result = await mutate(
      pool,
      request,
      async (c) => {
        await c.query("select id from organizations where id=$1 for update", [id]);
        await member(c, request.actor, id, ["OWNER"]);
      },
      async (c) => {
        for (const vaultId of input.allowedVaultIds)
          await first(c, "select id from registered_vaults where id=$1 and organization_id=$2", [
            vaultId,
            id,
          ]);
        await c.query(
          "insert into outbox(deduplication_key,event_type,aggregate_id,payload_json) values($1,'COVERAGE_REFRESH',$2,$3)",
          [`policy:${request.id}`, id, JSON.stringify({ organizationId: id })],
        );
        return {
          status: 201,
          body: await first(
            c,
            "insert into coverage_policies(organization_id,version_number,min_reward,max_data_age_seconds,allowed_vault_ids,approved_by) select $1,coalesce(max(version_number),0)+1,$2,$3,$4,$5 from coverage_policies where organization_id=$1 returning *",
            [
              id,
              input.minReward,
              input.maxDataAgeSeconds,
              JSON.stringify([...new Set(input.allowedVaultIds)]),
              request.actor.id,
            ],
          ),
        };
      },
    );
    return reply.code(result.status).send(result.body);
  });
  app.post("/api/v1/organizations/:id/programs", async (request, reply) => {
    const { id } = idParams(request);
    const input = parseApiBody("program", request);
    const result = await mutate(
      pool,
      request,
      (c) => member(c, request.actor, id, ["OWNER", "REVIEWER"]),
      async (c) => {
        if (input.coveragePolicyId)
          await first(c, "select id from coverage_policies where id=$1 and organization_id=$2", [
            input.coveragePolicyId,
            id,
          ]);
        return {
          status: 201,
          body: await first(
            c,
            "insert into programs(organization_id,name,coverage_policy_id) values($1,$2,$3) returning *",
            [id, input.name, input.coveragePolicyId ?? null],
          ),
        };
      },
    );
    return reply.code(result.status).send(result.body);
  });
  app.get("/api/v1/organizations/:id/programs", async (request) => {
    const { id } = idParams(request);
    await member(pool, request.actor, id);
    const page = pageParams.parse(request.query);
    const rows = (
      await pool.query(
        "select * from programs where organization_id=$1 and ($2::uuid is null or id>$2) order by id limit $3",
        [id, page.cursor ?? null, page.limit + 1],
      )
    ).rows;
    return {
      items: rows.slice(0, page.limit),
      nextCursor: rows.length > page.limit ? rows[page.limit - 1].id : null,
    };
  });
  registerReceiptRoutes(app, pool);
  registerRpcRoutes(app, pool);
  registerReadRoutes(app, pool);
  registerRecoveryRoutes(app, pool, options.recoveryChain);
  registerBountyRoutes(app, pool, options.bountyServices);
  registerTreasuryRoutes(app, pool, options.bountyServices?.escrow);
  registerFundingRoutes(app, pool, options.bountyServices?.escrow, options.walletIdentity);
  registerClaimRoutes(app, pool, options.claimServices, options.walletIdentity);
  registerCoverageRoutes(app, pool);
  registerBudgetRoutes(app, pool, options.budgetServices);
  registerOwnerRoutes(app, pool, options.budgetServices, options.walletIdentity);
  registerAssistantRoutes(app, pool, options.assistantModel);
  registerWalletRoutes(app, pool, options.walletIdentity);
  return app;
}
