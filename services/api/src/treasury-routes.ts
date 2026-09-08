import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { erc20Abi, type Hex } from "viem";
import { ARC_USDC, arcClient } from "../../../packages/chain/src/arc.ts";
import { address, DomainError } from "../../../packages/domain/src/index.ts";
import { first, idParams, member, mutate } from "./context.ts";
import { parseApiBody } from "./parse-body.ts";
import { pathSchemas } from "./request-schemas.ts";
export function registerTreasuryRoutes(app: FastifyInstance, pool: Pool, escrow?: Hex) {
  app.post("/api/v1/organizations/:id/wallets", async (request, reply) => {
    const { id } = idParams(request);
    const input = parseApiBody("treasurySetup", request);
    if (!escrow)
      throw new DomainError(
        "SERVICE_NOT_CONFIGURED",
        "Configure the escrow before creating a funding wallet.",
        503,
      );
    const result = await mutate(
      pool,
      request,
      (c) => member(c, request.actor, id, ["OWNER"]),
      async (c) => {
        const org = await first(c, "select onchain_id from organizations where id=$1 for update", [
          id,
        ]);
        const existing = (
          await c.query(
            "select id,state,wallet_id,max_per_action from wallet_setups where organization_id=$1",
            [id],
          )
        ).rows[0];
        if (existing) {
          if (existing.max_per_action !== input.maxPerAction)
            throw new DomainError(
              "SETUP_CONFLICT",
              "The existing wallet has a different approved amount cap.",
            );
          return { status: 202, body: existing };
        }
        const setup = await first(
          c,
          "insert into wallet_setups(organization_id,requested_by,max_per_action,configuration_json) values($1,$2,$3,$4) returning id,state",
          [
            id,
            request.actor.id,
            input.maxPerAction,
            JSON.stringify({
              organizationId: org.onchain_id,
              escrow: address.parse(escrow),
              maxPerAction: input.maxPerAction,
            }),
          ],
        );
        await c.query(
          "insert into outbox(deduplication_key,event_type,aggregate_id,payload_json) values($1,'WALLET_SETUP',$2,$3)",
          [`wallet-setup:${setup.id}`, id, JSON.stringify({ setupId: setup.id })],
        );
        return { status: 202, body: setup };
      },
    );
    return reply.code(result.status).send(result.body);
  });
  app.get("/api/v1/organizations/:id/wallets", async (request) => {
    const { id } = idParams(request);
    await member(pool, request.actor, id, ["OWNER", "TREASURY"]);
    return {
      items: (
        await pool.query(
          "select w.id,w.address,w.provider,w.chain_id,w.policy_ref,s.state,s.max_per_action,s.id as setup_id from wallet_setups s left join wallets w on w.id=s.wallet_id where s.organization_id=$1",
          [id],
        )
      ).rows,
    };
  });
  app.get("/api/v1/organizations/:id/wallets/:walletId/balance", async (request) => {
    const { id, walletId } = pathSchemas.wallet.parse(request.params);
    await member(pool, request.actor, id, ["OWNER", "TREASURY"]);
    const wallet = await first(
      pool,
      "select address from wallets where id=$1 and owner_type='ORGANIZATION' and owner_id=$2 and chain_id='5042002'",
      [walletId, id],
    );
    const chain = arcClient();
    const block = await chain.getBlock({ blockTag: "latest" });
    const amount = await chain.readContract({
      address: ARC_USDC,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [wallet.address],
      blockNumber: block.number,
    });
    return {
      amount: amount.toString(),
      decimals: 6,
      asset: ARC_USDC,
      chainId: "5042002",
      blockNumber: block.number.toString(),
    };
  });
}
