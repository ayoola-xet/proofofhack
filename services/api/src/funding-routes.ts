import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { type Hex, recoverMessageAddress } from "viem";
import { ARC_USDC } from "../../../packages/chain/src/arc.ts";
import {
  address,
  DomainError,
  hashPolicy,
  policySchema,
} from "../../../packages/domain/src/index.ts";
import { fundingAuthorizationMessage } from "../../../packages/privy/src/funding-authorization.ts";
import type { WalletIdentityProvider } from "../../../packages/privy/src/wallets.ts";
import { expectedVersion, first, idParams, member, mutate } from "./context.ts";
import { parseApiBody } from "./parse-body.ts";

export function registerFundingRoutes(
  app: FastifyInstance,
  pool: Pool,
  escrow?: Hex,
  identities?: WalletIdentityProvider,
) {
  app.post("/api/v1/bounty-drafts/:id/funding-requests", async (request, reply) => {
    const { id } = idParams(request);
    const input = parseApiBody("fundingRequest", request);
    const result = await mutate(
      pool,
      request,
      async (c) => {
        const draft = await first(
          c,
          "select p.organization_id from bounty_drafts d join programs p on p.id=d.program_id where d.id=$1",
          [id],
        );
        await member(c, request.actor, draft.organization_id, ["OWNER", "TREASURY"]);
      },
      async (c) => {
        const draft = await first(
          c,
          "select d.*,p.organization_id,o.onchain_id from bounty_drafts d join programs p on p.id=d.program_id join organizations o on o.id=p.organization_id where d.id=$1 and p.status='ACTIVE' and o.status='ACTIVE' for update of d",
          [id],
        );
        const policy = policySchema.parse(draft.policy_json);
        if (
          !escrow ||
          draft.status !== "APPROVED" ||
          !draft.approved_by ||
          hashPolicy(policy) !== input.policyHash ||
          draft.policy_hash !== input.policyHash ||
          policy.organizationId !== draft.onchain_id ||
          policy.settlementChainId !== "5042002" ||
          policy.escrow !== address.parse(escrow) ||
          policy.asset !== ARC_USDC
        )
          throw new DomainError("POLICY_MISMATCH", "Use the exact approved Arc bounty policy.");
        if (BigInt(policy.submissionDeadline) <= BigInt(Math.floor(Date.now() / 1000) + 120))
          throw new DomainError(
            "EXPIRED_POLICY",
            "Use a bounty with at least two minutes before its deadline.",
          );
        const wallet = await first(
          c,
          "select w.*,s.max_per_action from wallets w join wallet_setups s on s.wallet_id=w.id where w.id=$1 and w.owner_id=$2 and w.owner_type='ORGANIZATION' and w.provider='PRIVY' and w.chain_id='5042002' and s.state='READY'",
          [input.walletId, draft.organization_id],
        );
        if (
          policy.refundRecipient !== wallet.address ||
          BigInt(policy.reward) > BigInt(wallet.max_per_action)
        )
          throw new DomainError(
            "WALLET_POLICY_MISMATCH",
            "Use the approved refund wallet and amount cap.",
          );
        await first(
          c,
          "select id from wallets where id=$1 and owner_id=$2 and owner_type='USER' and provider='PRIVY' and chain_id='5042002'",
          [input.authorizationWalletId, request.actor.id],
        );
        await c.query(
          "update funding_requests set state='EXPIRED',updated_at=now() where draft_id=$1 and state='AWAITING_AUTHORIZATION' and authorization_expires_at<now()",
          [id],
        );
        const prior = (
          await c.query(
            "select id,state,authorization_message,version from funding_requests where draft_id=$1 and state not in ('CANCELLED','EXPIRED')",
            [id],
          )
        ).rows[0];
        if (prior) throw new DomainError("FUNDING_EXISTS", "Open the existing funding request.");
        const requestId = randomUUID(),
          expires = new Date(Date.now() + 600000);
        const message = fundingAuthorizationMessage({
          requestId,
          actorId: request.actor.id,
          walletAddress: wallet.address,
          policyHash: input.policyHash,
          policy,
          expiresAt: expires.toISOString(),
        });
        return {
          status: 201,
          body: await first(
            c,
            "insert into funding_requests(id,organization_id,draft_id,wallet_id,requested_by,authorization_wallet_id,authorization_message,authorization_expires_at) values($1,$2,$3,$4,$5,$6,$7,$8) returning id,state,authorization_message,authorization_expires_at,version",
            [
              requestId,
              draft.organization_id,
              id,
              input.walletId,
              request.actor.id,
              input.authorizationWalletId,
              message,
              expires,
            ],
          ),
        };
      },
    );
    return reply.code(result.status).send(result.body);
  });
  app.post("/api/v1/funding-requests/:id/authorize", async (request, reply) => {
    const { id } = idParams(request),
      version = expectedVersion(request);
    const input = parseApiBody("signature", request);
    const result = await mutate(
      pool,
      request,
      async (c) => {
        const row = await first(
          c,
          "select organization_id,requested_by from funding_requests where id=$1",
          [id],
        );
        await member(c, request.actor, row.organization_id, ["OWNER", "TREASURY"]);
        if (row.requested_by !== request.actor.id)
          throw new DomainError(
            "WRONG_AUTHORIZER",
            "The requesting member must confirm funding.",
            403,
          );
      },
      async (c) => {
        const row = await first(
          c,
          "select f.*,w.address,w.provider_wallet_id,u.privy_user_id from funding_requests f join wallets w on w.id=f.authorization_wallet_id join users u on u.id=f.requested_by where f.id=$1 for update of f",
          [id],
        );
        if (
          row.state !== "AWAITING_AUTHORIZATION" ||
          row.version !== version ||
          row.authorization_expires_at.getTime() <= Date.now()
        )
          throw new DomainError("STALE_AUTHORIZATION", "Prepare a new funding confirmation.");
        if (!identities)
          throw new DomainError(
            "SERVICE_NOT_CONFIGURED",
            "Wallet verification is not configured.",
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
          "update funding_requests set authorization_signature=$2,state='QUEUED',version=version+1,updated_at=now() where id=$1 returning id,state,version",
          [id, input.signature],
        );
        await c.query(
          "insert into outbox(deduplication_key,event_type,aggregate_id,payload_json) values($1,'BOUNTY_FUNDING',$2,$3)",
          [`bounty-funding:${id}`, row.organization_id, JSON.stringify({ fundingId: id })],
        );
        return { status: 202, body: saved };
      },
    );
    return reply.code(result.status).send(result.body);
  });
  app.post("/api/v1/funding-requests/:id/cancel", async (request, reply) => {
    const { id } = idParams(request);
    parseApiBody("empty", request);
    const result = await mutate(
      pool,
      request,
      async (c) => {
        await first(c, "select id from funding_requests where id=$1 and requested_by=$2", [
          id,
          request.actor.id,
        ]);
      },
      async (c) => ({
        status: 200,
        body: await first(
          c,
          "update funding_requests set state='CANCELLED',version=version+1,updated_at=now() where id=$1 and state='AWAITING_AUTHORIZATION' returning id,state,version",
          [id],
        ),
      }),
    );
    return reply.code(result.status).send(result.body);
  });
  app.get("/api/v1/organizations/:id/funding-requests", async (request) => {
    const { id } = idParams(request);
    await member(pool, request.actor, id, ["OWNER", "TREASURY", "REVIEWER"]);
    return {
      items: (
        await pool.query(
          "select f.id,f.draft_id,f.wallet_id,f.requested_by,f.state,f.failure_code,f.authorization_message,f.authorization_expires_at,f.version,a.transaction_hash as approval_hash,t.transaction_hash as funding_hash from funding_requests f left join transaction_intents a on a.id=f.approval_intent_id left join transaction_intents t on t.id=f.funding_intent_id where f.organization_id=$1 order by f.created_at desc limit 100",
          [id],
        )
      ).rows,
    };
  });
  app.post("/api/v1/funding-requests/:id/retry", async (request, reply) => {
    const { id } = idParams(request);
    parseApiBody("empty", request);
    const result = await mutate(
      pool,
      request,
      async (c) => {
        const row = await first(
          c,
          "select organization_id,requested_by from funding_requests where id=$1",
          [id],
        );
        await member(c, request.actor, row.organization_id, ["OWNER", "TREASURY"]);
        if (row.requested_by !== request.actor.id)
          throw new DomainError(
            "WRONG_AUTHORIZER",
            "The requesting member must retry this funding action.",
            403,
          );
      },
      async (c) => {
        const row = await first(c, "select * from funding_requests where id=$1 for update", [id]);
        if (!["QUEUED", "APPROVING", "FUNDING"].includes(row.state))
          throw new DomainError(
            "FUNDING_NOT_RETRYABLE",
            "This funding request cannot resume. Check its current state.",
          );
        await c.query(
          "insert into outbox(deduplication_key,event_type,aggregate_id,payload_json) values($1,'BOUNTY_FUNDING',$2,$3)",
          [
            `funding-retry:${id}:${row.version}`,
            row.organization_id,
            JSON.stringify({ fundingId: id }),
          ],
        );
        return {
          status: 202,
          body: await first(
            c,
            "update funding_requests set version=version+1,failure_code=null,updated_at=now() where id=$1 returning id,state,version",
            [id],
          ),
        };
      },
    );
    return reply.code(result.status).send(result.body);
  });
}
