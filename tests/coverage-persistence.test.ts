import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectDatabase } from "../packages/database/src/index.ts";
import { organizationHash } from "../packages/domain/src/index.ts";
import type { VaultObservationDTO } from "../packages/erc4626-coverage-data/src/client.ts";
import { refreshCoverage } from "../services/coverage/src/refresh.ts";

const { pool } = connectDatabase();
const userId = randomUUID(),
  orgId = randomUUID(),
  vaultId = randomUUID(),
  policyId = randomUUID();
const address = "0x83f20f44975d03b1b09e64809b757c47f942beea";
const now = new Date();
const observation: VaultObservationDTO = {
  sourceId: `1:${address}:100`,
  vaultId: `1:${address}`,
  chainId: "1",
  address,
  asset: "0x0000000000000000000000000000000000000001",
  assetDecimals: 18,
  schemaVersion: "1",
  deploymentId: "test-deployment",
  queryTime: now.toISOString(),
  observedBlock: "100",
  observedHash: `0x${"1".repeat(64)}`,
  observedAt: now.toISOString(),
  indexedHead: "105",
  indexedHeadAt: now.toISOString(),
  totalAssets: "500000000000000000000",
  totalSupply: "400000000000000000000",
  readStatus: "OK",
  hasIndexingErrors: false,
  label: "Test context",
};
beforeAll(async () => {
  await pool.query(
    "insert into users(id,privy_user_id,display_name) values($1,$2,'Coverage test')",
    [userId, `local:test:${userId}`],
  );
  await pool.query(
    "insert into organizations(id,onchain_id,name,owner_user_id) values($1,$2,'Coverage test',$3)",
    [orgId, organizationHash(orgId), userId],
  );
  await pool.query(
    "insert into registered_vaults(id,organization_id,source_chain_id,address,label) values($1,$2,'1',$3,'Test vault')",
    [vaultId, orgId, address],
  );
  await pool.query(
    "insert into coverage_policies(id,organization_id,version_number,min_reward,max_data_age_seconds,allowed_vault_ids,approved_by) values($1,$2,1,'1000000',300,$3,$4)",
    [policyId, orgId, JSON.stringify([vaultId]), userId],
  );
});
afterAll(async () => {
  await pool.query("delete from recommendations where organization_id=$1", [orgId]);
  await pool.query("delete from coverage_records where vault_id=$1", [vaultId]);
  await pool.query("delete from vault_observations where vault_id=$1", [vaultId]);
  await pool.query("delete from coverage_policies where organization_id=$1", [orgId]);
  await pool.query("delete from registered_vaults where organization_id=$1", [orgId]);
  await pool.query("delete from organizations where id=$1", [orgId]);
  await pool.query("delete from users where id=$1", [userId]);
  await pool.end();
});
describe("Durable coverage observations", () => {
  it("Keeps one observation and one decision across concurrent delivery", async () => {
    const provider = { query: async () => [observation] };
    await Promise.all(Array.from({ length: 4 }, () => refreshCoverage(pool, provider, orgId, now)));
    expect(
      (
        await pool.query("select count(*)::int n from vault_observations where vault_id=$1", [
          vaultId,
        ])
      ).rows[0].n,
    ).toBe(1);
    const rows = (
      await pool.query("select * from recommendations where organization_id=$1", [orgId])
    ).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("ABSTAIN");
    expect(rows[0].calculation_json.reasonCode).toBe("NO_APPROVED_POLICY");
    expect(rows[0].action_json).toBeNull();
    expect(rows[0].explanation).toContain(observation.sourceId);
  });
  it("Makes saved decisions unavailable when the provider fails", async () => {
    await expect(
      refreshCoverage(
        pool,
        {
          query: async () => {
            throw new Error("Unavailable");
          },
        },
        orgId,
        now,
      ),
    ).rejects.toThrow("Unavailable");
    const row = (await pool.query("select * from coverage_records where vault_id=$1", [vaultId]))
      .rows[0];
    expect(row.reason).toBe("PROVIDER_UNAVAILABLE");
    expect(
      (
        await pool.query(
          "select count(*)::int n from recommendations where organization_id=$1 and expires_at>now()",
          [orgId],
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it("Recovers after a fresh source response and stops on missing data", async () => {
    const later = new Date(now.getTime() + 1000);
    await refreshCoverage(pool, { query: async () => [observation] }, orgId, later);
    expect(
      (await pool.query("select reason from coverage_records where vault_id=$1", [vaultId])).rows[0]
        .reason,
    ).toBe("NO_APPROVED_POLICY");
    await refreshCoverage(pool, { query: async () => [] }, orgId, later);
    expect(
      (await pool.query("select reason from coverage_records where vault_id=$1", [vaultId])).rows[0]
        .reason,
    ).toBe("MISSING_OBSERVATION");
  });
});
