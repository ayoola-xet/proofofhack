import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { Hex } from "viem";
import { z } from "zod";
import { ARC_USDC } from "../../../packages/chain/src/arc.ts";
import {
  ADAPTER_ID,
  address,
  bytes32,
  DomainError,
  hashPolicy,
  policySchema,
  uint,
} from "../../../packages/domain/src/index.ts";
import {
  createManifestCases,
  manifestMessage,
  manifestSchema,
  verifyManifest,
} from "../../../packages/fixture-manifest/src/index.ts";
import type { InternalClient } from "../../../packages/service-auth/src/http.ts";
import type { PublicServiceConfig } from "../../../packages/service-config/src/index.ts";
import { expectedVersion, first, idParams, member, mutate } from "./context.ts";
export type BountyServices = {
  publicConfig: PublicServiceConfig;
  escrow: Hex;
  release: Pick<InternalClient, "post">;
};
const randomHash = () => `0x${randomBytes(32).toString("hex")}` as Hex;
export function registerBountyRoutes(app: FastifyInstance, pool: Pool, services?: BountyServices) {
  function configured() {
    if (!services)
      throw new DomainError("SERVICE_NOT_CONFIGURED", "Bounty services need configuration.", 503);
    return services;
  }
  app.get("/api/v1/verifier-config", async () => {
    const c = configured().publicConfig;
    return {
      evidenceScope: c.evidenceScope,
      verifierMode: c.verifierMode,
      evidenceKeyId: c.evidenceKeyId,
      evidencePublicKey: c.evidencePublicKey,
      admissionSigner: c.admissionSigner,
      verdictSigner: c.verdictSigner,
      adapterCodeHash: c.adapterCodeHash,
      verifierConfigHash: c.verifierConfigHash,
    };
  });
  app.post("/api/v1/organizations/:id/report-key", async (request, reply) => {
    const { id } = idParams(request);
    z.strictObject({}).parse(request.body ?? {});
    await member(pool, request.actor, id, ["OWNER"]);
    const key = await configured().release.post<{ keyId: string; publicKey: string }>(
      "/internal/organization-keys",
      { organizationId: id, actorId: request.actor.id },
    );
    const result = await mutate(
      pool,
      request,
      (c) => member(c, request.actor, id, ["OWNER"]),
      async () => ({ status: 200, body: key }),
    );
    return reply.code(result.status).send(result.body);
  });
  app.post("/api/v1/organizations/:id/fixture-manifests/prepare", async (request, reply) => {
    const { id } = idParams(request);
    const input = z
      .strictObject({ vaultId: z.uuid(), signingWalletId: z.uuid() })
      .parse(request.body);
    const result = await mutate(
      pool,
      request,
      (c) => member(c, request.actor, id, ["OWNER"]),
      async (c) => {
        const org = await first(c, "select onchain_id from organizations where id=$1", [id]);
        const wallet = await first(
          c,
          "select address from wallets where id=$1 and owner_type='USER' and owner_id=$2 and provider='PRIVY' and chain_id='5042002'",
          [input.signingWalletId, request.actor.id],
        );
        const vault = await first(
          c,
          `select v.source_chain_id,v.address,o.observed_hash,o.observed_at,o.metrics_json,o.read_status from registered_vaults v
        join lateral(select * from vault_observations where vault_id=v.id order by observed_at desc limit 1)o on true
        where v.id=$1 and v.organization_id=$2`,
          [input.vaultId, id],
        );
        if (
          vault.read_status !== "OK" ||
          !vault.observed_hash ||
          Date.now() - vault.observed_at.getTime() > 300000 ||
          vault.metrics_json.hasIndexingErrors ||
          !vault.metrics_json.indexedHeadAt ||
          !Number.isFinite(Date.parse(vault.metrics_json.indexedHeadAt)) ||
          Date.now() - Date.parse(vault.metrics_json.indexedHeadAt) > 300000
        )
          throw new DomainError(
            "STALE_SOURCE",
            "Update the vault source before preparing its manifest.",
          );
        const catalog = createManifestCases(
          [randomHash(), randomHash(), randomHash()],
          [randomHash(), randomHash(), randomHash()],
        );
        const manifest = manifestSchema.parse({
          schemaVersion: "1",
          synthetic: true,
          root: catalog.root,
          organizationId: org.onchain_id,
          sourceChainId: vault.source_chain_id,
          sourceVault: vault.address,
          sourceBlockHash: vault.observed_hash,
          createdAt: String(Math.floor(Date.now() / 1000)),
          version: "1",
          ownerAddress: wallet.address,
          cases: catalog.cases,
        });
        const row = await first(
          c,
          "insert into fixture_manifests(organization_id,signing_wallet_id,root,version_number,owner_signature,source_context_json,registered_by) values($1,$2,$3,'1','',$4,$5) returning id,status,version",
          [id, input.signingWalletId, catalog.root, JSON.stringify(manifest), request.actor.id],
        );
        return {
          status: 201,
          body: {
            ...row,
            manifest,
            message: manifestMessage(manifest),
            fixtures: catalog.fixtures,
          },
        };
      },
    );
    return reply.code(result.status).send(result.body);
  });
  app.post("/api/v1/fixture-manifests/:id/sign", async (request, reply) => {
    const { id } = idParams(request);
    const version = expectedVersion(request);
    const input = z
      .strictObject({ signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/) })
      .parse(request.body);
    const result = await mutate(
      pool,
      request,
      async (c) => {
        const row = await first(
          c,
          "select organization_id,registered_by from fixture_manifests where id=$1",
          [id],
        );
        await member(c, request.actor, row.organization_id, ["OWNER"]);
        if (row.registered_by !== request.actor.id)
          throw new DomainError(
            "WRONG_MANIFEST_OWNER",
            "The preparing owner must sign this manifest.",
            403,
          );
      },
      async (c) => {
        const row = await first(c, "select * from fixture_manifests where id=$1 for update", [id]);
        if (row.version !== version || row.status !== "PREPARED")
          throw new DomainError("STALE_RESOURCE", "Reload the current manifest.");
        await verifyManifest(row.source_context_json, input.signature as Hex);
        return {
          status: 200,
          body: await first(
            c,
            "update fixture_manifests set owner_signature=$2,status='SIGNED',version=version+1,updated_at=now() where id=$1 returning id,root,status,version",
            [id, input.signature],
          ),
        };
      },
    );
    return reply.code(result.status).send(result.body);
  });
  app.get("/api/v1/organizations/:id/fixture-manifests", async (request) => {
    const { id } = idParams(request);
    await member(pool, request.actor, id);
    return {
      items: (
        await pool.query(
          "select id,root,status,version,source_context_json as manifest from fixture_manifests where organization_id=$1 order by created_at desc limit 100",
          [id],
        )
      ).rows,
    };
  });
  app.post("/api/v1/programs/:id/bounty-drafts", async (request, reply) => {
    const { id } = idParams(request);
    const config = configured();
    const input = z
      .strictObject({
        manifestId: z.uuid(),
        refundWalletId: z.uuid().optional(),
        controllerId: z.uuid().optional(),
        reward: uint().refine((v) => BigInt(v) > 0n),
        minimumDiscrepancy: uint().refine((v) => BigInt(v) > 0n),
        submissionDeadline: uint(64),
        reservationDurationSeconds: z.number().int().min(60).max(1800),
      })
      .refine((v) => Boolean(v.refundWalletId) !== Boolean(v.controllerId), {
        message: "Select one refund wallet or budget controller.",
      })
      .parse(request.body);
    const result = await mutate(
      pool,
      request,
      async (c) => {
        const program = await first(
          c,
          "select organization_id from programs where id=$1 and status='ACTIVE'",
          [id],
        );
        await member(c, request.actor, program.organization_id, ["OWNER", "REVIEWER"]);
      },
      async (c) => {
        const program = await first(c, "select organization_id from programs where id=$1", [id]);
        const org = await first(c, "select onchain_id from organizations where id=$1", [
          program.organization_id,
        ]);
        const manifest = await first(
          c,
          "select * from fixture_manifests where id=$1 and organization_id=$2 and status='SIGNED'",
          [input.manifestId, program.organization_id],
        );
        const checked = await verifyManifest(
          manifest.source_context_json,
          manifest.owner_signature,
        );
        if (checked.manifest.organizationId !== org.onchain_id)
          throw new DomainError(
            "MANIFEST_SCOPE",
            "The manifest belongs to another organization.",
            400,
          );
        const refund = input.controllerId
          ? await first(
              c,
              "select address from budget_controllers where id=$1 and organization_id=$2 and chain_id='5042002' and asset=$3 and limit_projection_json->>'escrow'=$4",
              [input.controllerId, program.organization_id, ARC_USDC, config.escrow],
            )
          : await first(
              c,
              "select address from wallets where id=$1 and owner_type='ORGANIZATION' and owner_id=$2 and chain_id='5042002' and provider='PRIVY'",
              [input.refundWalletId, program.organization_id],
            );
        const key = await first(
          c,
          "select key_id from organization_keys where organization_id=$1 and status='ACTIVE'",
          [program.organization_id],
        );
        const deadline = BigInt(input.submissionDeadline),
          now = BigInt(Math.floor(Date.now() / 1000));
        if (deadline < now + 300n || deadline > now + 2592000n)
          throw new DomainError(
            "INVALID_DEADLINE",
            "Use a submission deadline from five minutes to thirty days from now.",
            400,
          );
        const policy = policySchema.parse({
          settlementChainId: "5042002",
          escrow: address.parse(config.escrow),
          organizationId: org.onchain_id,
          refundRecipient: refund.address,
          sourceChainId: checked.manifest.sourceChainId,
          sourceVault: checked.manifest.sourceVault,
          sourceBlockHash: checked.manifest.sourceBlockHash,
          fixtureManifestRoot: manifest.root,
          adapterId: ADAPTER_ID,
          adapterCodeHash: config.publicConfig.adapterCodeHash,
          verifierConfigHash: config.publicConfig.verifierConfigHash,
          admissionSigner: config.publicConfig.admissionSigner,
          verdictSigner: config.publicConfig.verdictSigner,
          reportRecipientKeyId: key.key_id,
          asset: ARC_USDC,
          reward: input.reward,
          minimumDiscrepancy: input.minimumDiscrepancy,
          submissionDeadline: input.submissionDeadline,
          settlementDeadline: (
            deadline +
            BigInt(input.reservationDurationSeconds) +
            3600n
          ).toString(),
          reservationDurationSeconds: String(input.reservationDurationSeconds),
          organizationNonce: randomHash(),
        });
        return {
          status: 201,
          body: await first(
            c,
            "insert into bounty_drafts(program_id,policy_json,policy_hash,created_by) values($1,$2,$3,$4) returning id,policy_json as policy,policy_hash,status,version",
            [id, JSON.stringify(policy), hashPolicy(policy), request.actor.id],
          ),
        };
      },
    );
    return reply.code(result.status).send(result.body);
  });
  app.get("/api/v1/organizations/:id/bounty-drafts", async (request) => {
    const { id } = idParams(request);
    await member(pool, request.actor, id);
    return {
      items: (
        await pool.query(
          "select d.id,d.program_id,d.policy_json as policy,d.policy_hash,d.status,d.version from bounty_drafts d join programs p on p.id=d.program_id where p.organization_id=$1 order by d.created_at desc limit 100",
          [id],
        )
      ).rows,
    };
  });
  app.post("/api/v1/bounty-drafts/:id/approve", async (request, reply) => {
    const { id } = idParams(request);
    const version = expectedVersion(request);
    const input = z.strictObject({ policyHash: bytes32 }).parse(request.body);
    const result = await mutate(
      pool,
      request,
      async (c) => {
        const row = await first(
          c,
          "select p.organization_id from bounty_drafts d join programs p on p.id=d.program_id where d.id=$1",
          [id],
        );
        await member(c, request.actor, row.organization_id, ["OWNER"]);
      },
      async (c) => {
        const row = await first(c, "select * from bounty_drafts where id=$1 for update", [id]);
        if (row.status !== "DRAFT" || row.version !== version)
          throw new DomainError("STALE_RESOURCE", "Reload the current bounty draft.");
        if (
          row.policy_hash !== input.policyHash ||
          hashPolicy(row.policy_json) !== input.policyHash
        )
          throw new DomainError("POLICY_MISMATCH", "Approve the exact policy hash.");
        if (BigInt(row.policy_json.submissionDeadline) <= BigInt(Math.floor(Date.now() / 1000)))
          throw new DomainError("EXPIRED_POLICY", "Create a draft with a future deadline.");
        return {
          status: 200,
          body: await first(
            c,
            "update bounty_drafts set status='APPROVED',approved_by=$2,version=version+1,updated_at=now() where id=$1 returning id,status,policy_hash,version",
            [id, request.actor.id],
          ),
        };
      },
    );
    return reply.code(result.status).send(result.body);
  });
}
