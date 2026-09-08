import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { type Hex, recoverMessageAddress } from "viem";
import { z } from "zod";
import {
  ownerAuthorizationMessage,
  ownerCommandSchema,
} from "../../../packages/chain/src/owner-command.ts";
import { address, DomainError } from "../../../packages/domain/src/index.ts";
import type { WalletIdentityProvider } from "../../../packages/privy/src/wallets.ts";
import { ownerContext, validateOwnerCommand } from "../../budget/src/owner-context.ts";
import type { BudgetServices } from "./budget-routes.ts";
import { expectedVersion, first, idParams, member, mutate } from "./context.ts";

export function registerOwnerRoutes(
  app: FastifyInstance,
  pool: Pool,
  services?: BudgetServices,
  identities?: WalletIdentityProvider,
) {
  app.post("/api/v1/controllers/:id/owner-requests", async (request, reply) => {
    const { id } = idParams(request),
      input = z
        .strictObject({ command: ownerCommandSchema, authorizationWalletId: z.uuid() })
        .parse(request.body);
    if (!services || !identities)
      throw new DomainError(
        "OWNER_NOT_CONFIGURED",
        "Owner wallet controls need configuration.",
        503,
      );
    const result = await mutate(
      pool,
      request,
      async (c) => {
        const { controller } = await ownerContext(c, id);
        await member(c, request.actor, controller.organization_id, ["OWNER"]);
      },
      async (c) => {
        const { controller, binding, setup, config } = await ownerContext(c, id);
        if (
          setup.state !== "READY" ||
          binding.escrow !== services.network.escrow ||
          binding.operator !== services.network.operator ||
          binding.chainId !== services.network.chainId
        )
          throw new DomainError(
            "OWNER_NOT_READY",
            "Verify the owner wallet and controller setup first.",
          );
        await first(c, "select id from organizations where id=$1 and status='ACTIVE'", [
          controller.organization_id,
        ]);
        await first(
          c,
          "select id from wallets where id=$1 and owner_id=$2 and owner_type='USER' and provider='PRIVY' and chain_id='5042002'",
          [input.authorizationWalletId, request.actor.id],
        );
        const command = await validateOwnerCommand(
          c,
          controller.organization_id,
          binding,
          config.maxPerAction,
          input.command,
        );
        await c.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
          `owner-request:${controller.owner_wallet_id}`,
        ]);
        await c.query(
          "update owner_requests set state='EXPIRED',updated_at=now() where wallet_id=$1 and state='AWAITING_AUTHORIZATION' and authorization_expires_at<=now()",
          [controller.owner_wallet_id],
        );
        if (
          (
            await c.query(
              "select id from owner_requests where wallet_id=$1 and state not in('COMPLETE','CANCELLED','EXPIRED','FAILED')",
              [controller.owner_wallet_id],
            )
          ).rowCount
        )
          throw new DomainError(
            "OWNER_REQUEST_EXISTS",
            "Complete or cancel the current owner request first.",
          );
        const requestId = randomUUID(),
          expires = new Date(Date.now() + 600000);
        const message = ownerAuthorizationMessage({
          requestId,
          actorId: request.actor.id,
          controller: binding.address,
          wallet: binding.owner,
          organizationId: binding.organizationId,
          command,
          expiresAt: expires.toISOString(),
        });
        return {
          status: 201,
          body: await first(
            c,
            "insert into owner_requests(id,organization_id,controller_id,wallet_id,requested_by,authorization_wallet_id,command_json,authorization_message,authorization_expires_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id,requested_by,authorization_wallet_id,command_json,authorization_message,authorization_expires_at,state,version",
            [
              requestId,
              controller.organization_id,
              id,
              controller.owner_wallet_id,
              request.actor.id,
              input.authorizationWalletId,
              JSON.stringify(command),
              message,
              expires,
            ],
          ),
        };
      },
    );
    return reply.code(result.status).send(result.body);
  });
  app.post("/api/v1/owner-requests/:id/authorize", async (request, reply) => {
    const { id } = idParams(request),
      version = expectedVersion(request),
      input = z
        .strictObject({ signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/) })
        .parse(request.body);
    const result = await mutate(
      pool,
      request,
      async (c) => {
        const row = await first(
          c,
          "select organization_id,requested_by from owner_requests where id=$1",
          [id],
        );
        await member(c, request.actor, row.organization_id, ["OWNER"]);
        if (row.requested_by !== request.actor.id)
          throw new DomainError(
            "WRONG_AUTHORIZER",
            "The requesting owner must confirm this action.",
            403,
          );
      },
      async (c) => {
        const row = await first(
          c,
          "select r.*,w.address,w.provider_wallet_id,u.privy_user_id from owner_requests r join wallets w on w.id=r.authorization_wallet_id join users u on u.id=r.requested_by where r.id=$1 for update of r",
          [id],
        );
        if (
          row.state !== "AWAITING_AUTHORIZATION" ||
          row.version !== version ||
          row.authorization_expires_at <= new Date()
        )
          throw new DomainError("STALE_AUTHORIZATION", "Prepare a new owner confirmation.");
        if (!identities)
          throw new DomainError(
            "OWNER_NOT_CONFIGURED",
            "Wallet verification needs configuration.",
            503,
          );
        const current = await identities.userWallets(row.privy_user_id);
        if (
          !current.some(
            (w) =>
              w.providerWalletId === row.provider_wallet_id &&
              address.parse(w.address) === row.address,
          ) ||
          address.parse(
            await recoverMessageAddress({
              message: row.authorization_message,
              signature: input.signature as Hex,
            }),
          ) !== row.address
        )
          throw new DomainError(
            "INVALID_AUTHORIZATION",
            "Confirm with your currently linked Privy wallet.",
            403,
          );
        const saved = await first(
          c,
          "update owner_requests set authorization_signature=$2,state='QUEUED',version=version+1,updated_at=now() where id=$1 returning id,state,version",
          [id, input.signature],
        );
        await c.query(
          "insert into outbox(deduplication_key,event_type,aggregate_id,payload_json) values($1,'OWNER_ACTION',$2,$3)",
          [
            `owner-action:${id}:${saved.version}`,
            row.organization_id,
            JSON.stringify({ requestId: id }),
          ],
        );
        return { status: 202, body: saved };
      },
    );
    return reply.code(result.status).send(result.body);
  });
  app.get("/api/v1/controllers/:id/owner-requests", async (request) => {
    const { id } = idParams(request),
      { controller } = await ownerContext(pool, id);
    await member(pool, request.actor, controller.organization_id);
    return {
      items: (
        await pool.query(
          "select r.id,r.requested_by,r.authorization_wallet_id,r.command_json,r.authorization_message,r.authorization_expires_at,r.state,r.failure_code,r.permission_pending,r.tx_intent_id,r.receipt_json,r.version,t.transaction_hash from owner_requests r left join transaction_intents t on t.id=r.tx_intent_id where r.controller_id=$1 order by r.created_at desc limit 50",
          [id],
        )
      ).rows,
    };
  });
  app.post("/api/v1/owner-requests/:id/cancel", async (request, reply) => {
    const { id } = idParams(request);
    z.strictObject({}).parse(request.body ?? {});
    const result = await mutate(
      pool,
      request,
      (c) =>
        first(c, "select id from owner_requests where id=$1 and requested_by=$2", [
          id,
          request.actor.id,
        ]),
      async (c) => {
        const row = await first(c, "select wallet_id from owner_requests where id=$1", [id]);
        await c.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
          `treasury-wallet:${row.wallet_id}`,
        ]);
        return {
          status: 200,
          body: await first(
            c,
            "update owner_requests set state='CANCELLED',version=version+1,updated_at=now() where id=$1 and state in('AWAITING_AUTHORIZATION','QUEUED') and tx_intent_id is null and permission_pending=false returning id,state,version",
            [id],
          ),
        };
      },
    );
    return reply.code(result.status).send(result.body);
  });
  app.post("/api/v1/owner-requests/:id/retry", async (request, reply) => {
    const { id } = idParams(request);
    z.strictObject({}).parse(request.body ?? {});
    const result = await mutate(
      pool,
      request,
      async (c) => {
        const row = await first(c, "select organization_id from owner_requests where id=$1", [id]);
        await member(c, request.actor, row.organization_id, ["OWNER"]);
      },
      async (c) => {
        const row = await first(c, "select * from owner_requests where id=$1 for update", [id]);
        if (
          ["COMPLETE", "FAILED", "CANCELLED", "EXPIRED", "AWAITING_AUTHORIZATION"].includes(
            row.state,
          )
        )
          throw new DomainError(
            "OWNER_NOT_RETRYABLE",
            "Only a pending owner action can retry its saved transaction.",
          );
        const saved = await first(
          c,
          "update owner_requests set version=version+1,updated_at=now() where id=$1 returning id,state,version",
          [id],
        );
        await c.query(
          "insert into outbox(deduplication_key,event_type,aggregate_id,payload_json) values($1,'OWNER_ACTION',$2,$3)",
          [
            `owner-action:${id}:${saved.version}`,
            row.organization_id,
            JSON.stringify({ requestId: id }),
          ],
        );
        return { status: 202, body: saved };
      },
    );
    return reply.code(result.status).send(result.body);
  });
}
