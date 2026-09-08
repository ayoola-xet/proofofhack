import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import type { RecoveryChain } from "../../../packages/chain/src/recovery.ts";
import { bytes32, DomainError } from "../../../packages/domain/src/index.ts";
import { reconcileRecovery } from "../../worker/src/recovery-receipt.ts";
import { first, member, mutate } from "./context.ts";

export function registerRecoveryRoutes(app: FastifyInstance, pool: Pool, chain?: RecoveryChain) {
  app.post("/api/v1/bounties/:id/recovery-receipts", async (request, reply) => {
    const { id } = z.object({ id: bytes32 }).parse(request.params);
    const { transactionHash } = z.strictObject({ transactionHash: bytes32 }).parse(request.body);
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
