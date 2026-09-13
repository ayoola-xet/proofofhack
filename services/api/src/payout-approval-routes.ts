import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { type Hex, recoverMessageAddress } from "viem";
import {
  address,
  DomainError,
  LARGE_PAYOUT_REQUIRED_APPROVALS,
} from "../../../packages/domain/src/index.ts";
import { payoutApprovalMessage } from "../../../packages/privy/src/funding-authorization.ts";
import type { WalletIdentityProvider } from "../../../packages/privy/src/wallets.ts";
import { first, idParams, member, mutate } from "./context.ts";
import { parseApiBody } from "./parse-body.ts";

export function registerPayoutApprovalRoutes(
  app: FastifyInstance,
  pool: Pool,
  identities?: WalletIdentityProvider,
) {
  app.get("/api/v1/organizations/:id/payout-approvals", async (request) => {
    const { id } = idParams(request);
    await member(pool, request.actor, id, ["OWNER", "TREASURY"]);
    const approvals = (
      await pool.query(
        `select a.id,a.claim_id,a.reward,a.required_approvals,a.state,a.expires_at,
          (select count(*)::int from payout_approval_signatures s where s.approval_id=a.id) as signatures,
          f.title,f.tier_id
         from payout_approvals a
         left join findings f on f.claim_id=a.claim_id
         where a.organization_id=$1 order by a.created_at desc limit 50`,
        [id],
      )
    ).rows;
    return {
      items: approvals.map((row) => ({
        ...row,
        message: payoutApprovalMessage({
          approvalId: row.id,
          claimId: row.claim_id,
          reward: row.reward,
          requiredApprovals: row.required_approvals,
          expiresAt: row.expires_at.toISOString(),
        }),
      })),
    };
  });
  app.post("/api/v1/payout-approvals/:id/sign", async (request, reply) => {
    if (!identities)
      throw new DomainError(
        "SERVICE_NOT_CONFIGURED",
        "Wallet verification is not configured.",
        503,
      );
    const { id } = idParams(request);
    const input = parseApiBody("payoutApprovalSignature", request);
    const result = await mutate(
      pool,
      request,
      async (c) => {
        const row = await first(c, "select organization_id from payout_approvals where id=$1", [
          id,
        ]);
        await member(c, request.actor, row.organization_id, ["OWNER", "TREASURY"]);
      },
      async (c) => {
        const approval = await first(c, "select * from payout_approvals where id=$1 for update", [
          id,
        ]);
        if (approval.state !== "PENDING" || approval.expires_at.getTime() <= Date.now())
          throw new DomainError("STALE_APPROVAL", "This payout approval is no longer open.");
        const wallet = await first(
          c,
          "select w.*,u.privy_user_id from wallets w join users u on u.id=w.owner_id where w.id=$1 and w.owner_id=$2 and w.owner_type='USER' and w.provider='PRIVY'",
          [input.walletId, request.actor.id],
        );
        const live = await identities.userWallets(wallet.privy_user_id);
        if (
          !live.some(
            (w) =>
              w.providerWalletId === wallet.provider_wallet_id &&
              w.address.toLowerCase() === wallet.address,
          )
        )
          throw new DomainError("WALLET_UNLINKED", "Verify a currently linked reward wallet.", 403);
        const message = payoutApprovalMessage({
          approvalId: approval.id,
          claimId: approval.claim_id,
          reward: approval.reward,
          requiredApprovals: approval.required_approvals,
          expiresAt: approval.expires_at.toISOString(),
        });
        if (
          address.parse(
            await recoverMessageAddress({ message, signature: input.signature as Hex }),
          ) !== wallet.address
        )
          throw new DomainError(
            "INVALID_AUTHORIZATION",
            "Confirm with your linked Privy wallet.",
            403,
          );
        const existing = await c.query(
          "select id from payout_approval_signatures where approval_id=$1 and member_user_id=$2",
          [id, request.actor.id],
        );
        if (existing.rows.length === 0)
          await c.query(
            "insert into payout_approval_signatures(approval_id,member_user_id,wallet_id,message,signature) values($1,$2,$3,$4,$5)",
            [id, request.actor.id, wallet.id, message, input.signature],
          );
        const count = (
          await c.query(
            "select count(*)::int n from payout_approval_signatures where approval_id=$1",
            [id],
          )
        ).rows[0].n;
        let state = approval.state;
        if (count >= approval.required_approvals && approval.state === "PENDING") {
          state = "APPROVED";
          await c.query(
            "update payout_approvals set state='APPROVED',updated_at=now() where id=$1",
            [id],
          );
          await c.query(
            "insert into outbox(deduplication_key,event_type,aggregate_id,payload_json) values($1,'CLAIM_PROCESS',$2,$3) on conflict(deduplication_key) do nothing",
            [
              `payout-approved:${approval.claim_id}`,
              approval.claim_id,
              JSON.stringify({ claimId: approval.claim_id }),
            ],
          );
        }
        return { status: 200, body: { id, state, signatures: count } };
      },
    );
    return reply.code(result.status).send(result.body);
  });
}
