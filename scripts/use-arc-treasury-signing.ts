import "dotenv/config";
import { z } from "zod";
import { connectDatabase } from "../packages/database/src/index.ts";
import { PrivyTreasury } from "../packages/privy/src/treasury.ts";
import { loadTestnetSecret } from "../packages/service-config/src/index.ts";

const setupId = z.uuid().parse(process.argv[2]);
const { pool } = connectDatabase();
const c = await pool.connect();
try {
  await c.query("select pg_advisory_lock(hashtextextended($1,0))", [`wallet-setup:${setupId}`]);
  const setup = (
    await c.query(
      "select s.*,w.address from wallet_setups s join wallets w on w.id=s.wallet_id where s.id=$1",
      [setupId],
    )
  ).rows[0];
  if (!setup) throw new Error("The existing treasury wallet is required.");
  const authorization = z
    .object({
      publicKey: z.string(),
      privateKey: z.string(),
      purpose: z.literal("PRIVY_ORGANIZATION_AUTHORIZATION"),
    })
    .parse(await loadTestnetSecret(".local/keys/privy-authorization.json"));
  const provider = new PrivyTreasury(
    z.string().parse(process.env.PRIVY_APP_ID),
    z.string().parse(process.env.PRIVY_APP_SECRET),
    authorization,
  );
  await c.query("update wallet_setups set state='VERIFYING',updated_at=now() where id=$1", [
    setupId,
  ]);
  await provider.configureArcSigning(
    {
      id: setup.provider_wallet_id,
      address: setup.address,
      ownerId: setup.owner_id,
      policyIds: [setup.provider_policy_id],
    },
    setup.configuration_json,
  );
  await c.query(
    "update wallet_setups set state='READY',updated_at=now(),version=version+1 where id=$1",
    [setupId],
  );
  console.log("The treasury policy now uses restricted Arc transaction signing.");
} catch {
  console.error("The policy migration did not complete. The wallet requires verification.");
  process.exitCode = 1;
} finally {
  await c.query("select pg_advisory_unlock(hashtextextended($1,0))", [`wallet-setup:${setupId}`]);
  c.release();
  await pool.end();
}
