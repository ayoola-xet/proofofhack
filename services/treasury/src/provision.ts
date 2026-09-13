import type { Pool } from "pg";
import { z } from "zod";
import { address, bytes32 } from "../../../packages/domain/src/index.ts";
import type { TreasuryProvider, TreasuryWallet } from "../../../packages/privy/src/treasury.ts";
import { first, member } from "../../api/src/context.ts";
export async function provisionTreasury(pool: Pool, provider: TreasuryProvider, setupId: string) {
  z.uuid().parse(setupId);
  const c = await pool.connect();
  let locked = false;
  try {
    const result = await c.query("select pg_try_advisory_lock(hashtextextended($1,0)) as locked", [
      `wallet-setup:${setupId}`,
    ]);
    locked = result.rows[0].locked;
    if (!locked) throw new Error("Wallet setup is already running.");
    let setup = await first(c, "select * from wallet_setups where id=$1", [setupId]);
    if (setup.state === "READY") return { state: "READY", walletId: setup.wallet_id };
    await member(c, { id: setup.requested_by, displayName: "" }, setup.organization_id, ["OWNER"]);
    await first(c, "select id from organizations where id=$1 and status='ACTIVE'", [
      setup.organization_id,
    ]);
    const config = z
      .strictObject({ organizationId: bytes32, escrow: address, maxPerAction: z.string() })
      .parse(setup.configuration_json);
    if (
      setup.attempt_started_at &&
      Date.now() - setup.attempt_started_at.getTime() > 23 * 60 * 60 * 1000 &&
      (!setup.provider_policy_id || !setup.wallet_id)
    ) {
      await c.query(
        "update wallet_setups set state='NEEDS_RECONCILIATION',updated_at=now() where id=$1",
        [setupId],
      );
      throw new Error("The provider idempotency window requires manual reconciliation.");
    }
    setup = await first(
      c,
      "update wallet_setups set state='PROVISIONING',attempt_started_at=coalesce(attempt_started_at,now()),updated_at=now() where id=$1 returning *",
      [setupId],
    );
    if (!setup.provider_policy_id) {
      const policyId = await provider.createPolicy(`${setupId}-policy`, config);
      await c.query("update wallet_setups set provider_policy_id=$2,updated_at=now() where id=$1", [
        setupId,
        policyId,
      ]);
      setup.provider_policy_id = policyId;
    }
    let wallet: TreasuryWallet;
    if (setup.wallet_id) {
      const saved = await first(
        c,
        "select * from wallets where id=$1 and owner_type='ORGANIZATION' and owner_id=$2",
        [setup.wallet_id, setup.organization_id],
      );
      wallet = {
        id: saved.provider_wallet_id,
        address: address.parse(saved.address),
        ownerId: setup.owner_id,
        policyIds: [setup.provider_policy_id],
      };
    } else {
      wallet = await provider.createWallet(setupId, setup.provider_policy_id);
      await c.query("begin");
      try {
        const saved = await first(
          c,
          `insert into wallets(provider,provider_wallet_id,owner_type,owner_id,chain_id,address,policy_ref)
          values('PRIVY',$1,'ORGANIZATION',$2,'5042002',$3,$4) returning id`,
          [wallet.id, setup.organization_id, wallet.address, setup.provider_policy_id],
        );
        await c.query(
          "update wallet_setups set wallet_id=$2,provider_wallet_id=$3,owner_id=$4,state='VERIFYING',updated_at=now() where id=$1",
          [setupId, saved.id, wallet.id, wallet.ownerId],
        );
        await c.query("commit");
        setup.wallet_id = saved.id;
      } catch (error) {
        await c.query("rollback");
        throw error;
      }
    }
    try {
      await provider.verify(wallet, config);
    } catch (err) {
      if (typeof provider.configureArcSigning === "function") {
        await provider.configureArcSigning(wallet, config);
      } else {
        throw err;
      }
    }
    await c.query(
      "update wallet_setups set state='READY',version=version+1,updated_at=now() where id=$1",
      [setupId],
    );
    return { state: "READY", walletId: setup.wallet_id };
  } finally {
    if (locked)
      await c.query("select pg_advisory_unlock(hashtextextended($1,0))", [
        `wallet-setup:${setupId}`,
      ]);
    c.release();
  }
}
