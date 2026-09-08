import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { Hex } from "viem";
import { z } from "zod";
import type { BudgetChain } from "../../../packages/chain/src/budget.ts";
import { address, bytes32, DomainError } from "../../../packages/domain/src/index.ts";
import {
  controllerContext,
  registerController,
  syncApproval,
  syncController,
} from "../../budget/src/controllers.ts";
import { enqueueAllocation } from "../../budget/src/enqueue.ts";
import { first, idParams, member, mutate } from "./context.ts";
export type BudgetServices = {
  chain: BudgetChain;
  network: { chainId: number; asset: Hex; escrow: Hex; operator: Hex };
};
export function registerBudgetRoutes(app: FastifyInstance, pool: Pool, services?: BudgetServices) {
  const configured = () => {
    if (!services)
      throw new DomainError("BUDGET_NOT_CONFIGURED", "The budget service is not configured.", 503);
    return services;
  };
  app.get("/api/v1/organizations/:id/controllers", async (request) => {
    const { id } = idParams(request);
    await member(pool, request.actor, id);
    return {
      items: (
        await pool.query(
          "select c.*,ow.address as owner_address,op.address as operator_address from budget_controllers c join wallets ow on ow.id=c.owner_wallet_id join wallets op on op.id=c.operator_wallet_id where c.organization_id=$1 order by c.created_at",
          [id],
        )
      ).rows,
    };
  });
  app.post("/api/v1/organizations/:id/controllers", async (request, reply) => {
    const { id } = idParams(request),
      input = z
        .strictObject({
          address,
          deploymentHash: bytes32,
          ownerWalletId: z.uuid(),
          operatorWalletId: z.uuid(),
        })
        .parse(request.body),
      service = configured();
    await member(pool, request.actor, id, ["OWNER"]);
    const result = await mutate(
      pool,
      request,
      (c) => member(c, request.actor, id, ["OWNER"]),
      async (c) => ({
        status: 201,
        body: await registerController(
          c,
          service.chain,
          { ...input, organizationId: id },
          service.network,
        ),
      }),
    );
    return reply.code(result.status).send(result.body);
  });
  app.post("/api/v1/controllers/:id/refresh", async (request, reply) => {
    const { id } = idParams(request),
      service = configured();
    z.strictObject({}).parse(request.body ?? {});
    const result = await mutate(
      pool,
      request,
      async (c) => {
        const { row } = await controllerContext(c, id);
        await member(c, request.actor, row.organization_id);
      },
      async (c) => {
        await syncController(c, service.chain, id);
        const { row } = await controllerContext(c, id);
        await c.query(
          "insert into outbox(deduplication_key,event_type,aggregate_id,payload_json) values($1,'COVERAGE_REFRESH',$2,$3) on conflict(deduplication_key) do nothing",
          [
            `controller-refresh:${request.id}`,
            row.organization_id,
            JSON.stringify({ organizationId: row.organization_id }),
          ],
        );
        return { status: 200, body: row };
      },
    );
    return reply.code(result.status).send(result.body);
  });
  app.post("/api/v1/controllers/:id/approvals/sync", async (request, reply) => {
    const { id } = idParams(request),
      { draftId } = z.strictObject({ draftId: z.uuid() }).parse(request.body),
      service = configured();
    const result = await mutate(
      pool,
      request,
      async (c) => {
        const { row } = await controllerContext(c, id);
        await member(c, request.actor, row.organization_id, ["OWNER", "TREASURY"]);
      },
      async (c) => {
        const row = await syncApproval(c, service.chain, id, draftId),
          { row: controller } = await controllerContext(c, id);
        await c.query(
          "insert into outbox(deduplication_key,event_type,aggregate_id,payload_json) values($1,'COVERAGE_REFRESH',$2,$3) on conflict(deduplication_key) do nothing",
          [
            `approval-sync:${request.id}`,
            controller.organization_id,
            JSON.stringify({ organizationId: controller.organization_id }),
          ],
        );
        return { status: 200, body: row };
      },
    );
    return reply.code(result.status).send(result.body);
  });
  app.get("/api/v1/controllers/:id/approvals", async (request) => {
    const { id } = idParams(request),
      { row } = await controllerContext(pool, id);
    await member(pool, request.actor, row.organization_id);
    return {
      items: (
        await pool.query(
          "select id,policy_hash,reward,expires_at,consumed_event_ref from approved_allocations where controller_id=$1 order by created_at desc limit 100",
          [id],
        )
      ).rows,
    };
  });
  app.post("/api/v1/organizations/:id/allocations", async (request, reply) => {
    const { id } = idParams(request),
      { recommendationId } = z.strictObject({ recommendationId: z.uuid() }).parse(request.body);
    configured();
    const result = await mutate(
      pool,
      request,
      (c) => member(c, request.actor, id, ["OWNER", "TREASURY"]),
      async (c) => ({ status: 202, body: await enqueueAllocation(c, id, recommendationId) }),
    );
    return reply.code(result.status).send(result.body);
  });
  app.get("/api/v1/organizations/:id/allocations", async (request) => {
    const { id } = idParams(request);
    await member(pool, request.actor, id);
    return {
      items: (
        await pool.query(
          "select a.*,t.transaction_hash from agent_actions a join budget_controllers c on c.id=a.controller_id left join transaction_intents t on t.id=a.tx_intent_id where c.organization_id=$1 order by a.created_at desc limit 100",
          [id],
        )
      ).rows,
    };
  });
  app.get("/api/v1/allocations/:id", async (request) => {
    const { id } = idParams(request),
      row = await first(
        pool,
        "select a.*,c.organization_id,t.transaction_hash from agent_actions a join budget_controllers c on c.id=a.controller_id left join transaction_intents t on t.id=a.tx_intent_id where a.id=$1",
        [id],
      );
    await member(pool, request.actor, row.organization_id);
    return row;
  });
  app.post("/api/v1/allocations/:id/retry", async (request, reply) => {
    const { id } = idParams(request);
    z.strictObject({}).parse(request.body ?? {});
    configured();
    const result = await mutate(
      pool,
      request,
      async (c) => {
        const row = await first(
          c,
          "select c.organization_id from agent_actions a join budget_controllers c on c.id=a.controller_id where a.id=$1",
          [id],
        );
        await member(c, request.actor, row.organization_id, ["OWNER", "TREASURY"]);
      },
      async (c) => {
        const row = await first(c, "select * from agent_actions where id=$1 for update", [id]);
        if (!["QUEUED", "PREPARED", "SUBMITTED", "CONFIRMING"].includes(row.state))
          throw new DomainError(
            "ALLOCATION_NOT_RETRYABLE",
            "Only a pending allocation can retry its saved request.",
          );
        const updated = await first(
          c,
          "update agent_actions set version=version+1,updated_at=now() where id=$1 returning *",
          [id],
        );
        await c.query(
          "insert into outbox(deduplication_key,event_type,aggregate_id,payload_json) values($1,'BUDGET_ALLOCATION',$2,$3)",
          [`allocation:${id}:${updated.version}`, id, JSON.stringify({ actionId: id })],
        );
        return { status: 202, body: updated };
      },
    );
    return reply.code(result.status).send(result.body);
  });
}
