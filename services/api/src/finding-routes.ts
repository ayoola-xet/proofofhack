import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { DomainError } from "../../../packages/domain/src/index.ts";
import type { WalletIdentityProvider } from "../../../packages/privy/src/wallets.ts";
import type { ClaimServices } from "./claim-routes.ts";
import { first, idParams, member, mutate, pageParams } from "./context.ts";
import { parseApiBody } from "./parse-body.ts";
import { pathSchemas } from "./request-schemas.ts";

export function registerFindingRoutes(
  app: FastifyInstance,
  pool: Pool,
  services?: ClaimServices,
  identities?: WalletIdentityProvider,
) {
  app.post(
    "/api/v1/organizations/:id/programs/:programId/severity-tiers",
    async (request, reply) => {
      const { id, programId } = pathSchemas.programTier.parse(request.params);
      const input = parseApiBody("severityTier", request);
      const result = await mutate(
        pool,
        request,
        async (c) => {
          await member(c, request.actor, id, ["OWNER"]);
          await first(c, "select id from programs where id=$1 and organization_id=$2", [
            programId,
            id,
          ]);
        },
        async (c) => ({
          status: 201,
          body: await first(
            c,
            "insert into severity_tiers(program_id,name,min_reward,max_reward,asset,display_order) values($1,$2,$3,$4,'',0) returning id,program_id,name,min_reward,max_reward,display_order",
            [programId, input.name, input.minReward, input.maxReward],
          ),
        }),
      );
      return reply.code(result.status).send(result.body);
    },
  );
  app.get("/api/v1/programs", async (request) => {
    const page = pageParams.parse(request.query);
    const rows = (
      await pool.query(
        `select p.id,p.name,p.scope_summary,p.rules_summary,p.disclosure_policy,o.name as organization_name
         from programs p join organizations o on o.id=p.organization_id
         where p.kind='FINDINGS' and p.visibility='PUBLIC' and p.status='ACTIVE'
           and ($1::uuid is null or p.id>$1)
         order by p.id limit $2`,
        [page.cursor ?? null, page.limit + 1],
      )
    ).rows;
    return {
      items: rows.slice(0, page.limit),
      nextCursor: rows.length > page.limit ? rows[page.limit - 1].id : null,
    };
  });
  app.get("/api/v1/programs/:id", async (request) => {
    const { id } = idParams(request);
    const program = await first(
      pool,
      `select p.id,p.name,p.scope_summary,p.rules_summary,p.disclosure_policy,o.name as organization_name
       from programs p join organizations o on o.id=p.organization_id
       where p.id=$1 and p.kind='FINDINGS' and p.visibility='PUBLIC' and p.status='ACTIVE'`,
      [id],
    );
    const tiers = (
      await pool.query(
        "select id,name,min_reward,max_reward,display_order from severity_tiers where program_id=$1 order by display_order,min_reward desc",
        [id],
      )
    ).rows;
    const openSlots = (
      await pool.query(
        `select severity_tier_id,count(*)::int n from bounties
         where program_id=$1 and chain_state='FUNDED' and bounty_id not in (select bounty_id from claims)
         group by severity_tier_id`,
        [id],
      )
    ).rows;
    const openByTier = new Map(openSlots.map((row) => [row.severity_tier_id, row.n]));
    // The next finding submitted against a tier claims its oldest open slot, so
    // show researchers that slot's in-scope contract address up front.
    const nextScope = (
      await pool.query(
        `select distinct on (severity_tier_id) severity_tier_id, policy_json->>'sourceVault' as scope_address
         from bounties
         where program_id=$1 and chain_state='FUNDED' and bounty_id not in (select bounty_id from claims)
         order by severity_tier_id, created_at`,
        [id],
      )
    ).rows;
    const scopeByTier = new Map(nextScope.map((row) => [row.severity_tier_id, row.scope_address]));
    return {
      ...program,
      tiers: tiers.map((tier) => ({
        ...tier,
        openSlots: openByTier.get(tier.id) ?? 0,
        scopeAddress: scopeByTier.get(tier.id) ?? null,
      })),
    };
  });
  app.post("/api/v1/programs/:id/findings", async (request, reply) => {
    if (!services || !identities)
      throw new DomainError("SERVICE_NOT_CONFIGURED", "Finding services are not configured.", 503);
    const { id } = idParams(request);
    const input = parseApiBody("finding", request);
    const wallet = await first(
      pool,
      "select w.*,u.privy_user_id from wallets w join users u on u.id=w.owner_id where w.id=$1 and w.owner_type='USER' and w.owner_id=$2 and w.provider='PRIVY'",
      [input.claimantWalletId, request.actor.id],
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
    const result = await mutate(
      pool,
      request,
      async () => {},
      async (c) => {
        const tier = await first(
          c,
          "select t.*,p.kind,p.status from severity_tiers t join programs p on p.id=t.program_id where t.id=$1 and t.program_id=$2",
          [input.tierId, id],
        );
        if (tier.kind !== "FINDINGS" || tier.status !== "ACTIVE")
          throw new DomainError(
            "PROGRAM_UNAVAILABLE",
            "This program does not accept findings now.",
          );
        await c.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
          `finding-slot:${input.tierId}`,
        ]);
        const bounty = await first(
          c,
          `select * from bounties where program_id=$1 and severity_tier_id=$2 and chain_state='FUNDED'
             and bounty_id not in (select bounty_id from claims) order by created_at limit 1`,
          [id, input.tierId],
        );
        const adapterConfig = services.configs[bounty.policy_json.adapterId];
        if (
          !adapterConfig ||
          bounty.policy_json.adapterCodeHash !== adapterConfig.adapterCodeHash ||
          bounty.policy_json.verifierConfigHash !== adapterConfig.verifierConfigHash
        )
          throw new DomainError(
            "VERIFIER_VERSION_UNAVAILABLE",
            "This program needs its original verifier version.",
          );
        if (input.keyId !== adapterConfig.evidenceKeyId)
          throw new DomainError("EVIDENCE_KEY_MISMATCH", "Refresh the verifier encryption key.");
        const uploadId = randomUUID(),
          claimId = `0x${randomBytes(32).toString("hex")}`;
        await c.query(
          "insert into uploads(id,owner_user_id,bounty_id,object_key,ciphertext_hash,key_id,byte_length,state,expires_at) values($1::uuid,$2,$3,$1::text,$4,$5,$6,'UPLOADING',now()+interval '24 hours')",
          [
            uploadId,
            request.actor.id,
            bounty.bounty_id,
            input.ciphertextHash,
            input.keyId,
            input.byteLength,
          ],
        );
        await c.query(
          "insert into claims(claim_id,bounty_id,researcher_user_id,claimant_wallet_id,claimant_address,upload_id,evidence_commitment,job_state) values($1,$2,$3,$4,$5,$6,$7,'UPLOADING')",
          [
            claimId,
            bounty.bounty_id,
            request.actor.id,
            wallet.id,
            wallet.address,
            uploadId,
            input.ciphertextHash,
          ],
        );
        await c.query(
          `insert into findings(program_id,tier_id,researcher_user_id,claim_id,title,summary,affected_component,self_assessed_severity,status)
           values($1,$2,$3,$4,$5,$6,$7,$8,'SUBMITTED')`,
          [
            id,
            input.tierId,
            request.actor.id,
            claimId,
            input.title,
            input.summary,
            input.affectedComponent,
            input.selfAssessedSeverity,
          ],
        );
        return {
          status: 201,
          body: {
            uploadId,
            claimId,
            bountyId: bounty.bounty_id,
            state: "UPLOADING",
            uploadPath: `/api/v1/uploads/${uploadId}/ciphertext`,
            expiresInSeconds: 900,
          },
        };
      },
    );
    return reply.code(result.status).send(result.body);
  });
  app.get("/api/v1/findings/me", async (request) => ({
    items: (
      await pool.query(
        `select f.id,f.program_id,f.tier_id,f.title,f.summary,f.affected_component,f.self_assessed_severity,
                f.verdict_severity,f.verdict_reasoning,f.measured_impact,f.status,f.claim_id,
                p.name as program_name,t.name as tier_name,
                b.reward as tier_max_reward,c.job_state,r.id as report_id,r.state as report_state
         from findings f
         join programs p on p.id=f.program_id
         join severity_tiers t on t.id=f.tier_id
         left join claims c on c.claim_id=f.claim_id
         left join bounties b on b.bounty_id=c.bounty_id
         left join reports r on r.claim_id=f.claim_id
         where f.researcher_user_id=$1 order by f.created_at desc limit 100`,
        [request.actor.id],
      )
    ).rows,
  }));
  app.get("/api/v1/organizations/:id/findings", async (request) => {
    const { id } = idParams(request);
    await member(pool, request.actor, id, ["OWNER", "REVIEWER"]);
    return {
      items: (
        await pool.query(
          `select f.id,f.program_id,f.tier_id,f.title,f.summary,f.affected_component,f.self_assessed_severity,
                  f.verdict_severity,f.status,f.claim_id,t.name as tier_name,
                  r.id as report_id,r.state as report_state
           from findings f
           join programs p on p.id=f.program_id
           join severity_tiers t on t.id=f.tier_id
           left join reports r on r.claim_id=f.claim_id
           where p.organization_id=$1 order by f.created_at desc limit 100`,
          [id],
        )
      ).rows,
    };
  });
}
