import "dotenv/config";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { encodeFunctionData, toHex } from "viem";
import { z } from "zod";
import { bountyEscrowAbi } from "../packages/chain/src/abi/BountyEscrow.ts";
import { ARC_USDC } from "../packages/chain/src/arc.ts";
import { contractPolicy } from "../packages/chain/src/policy.ts";
import { connectDatabase } from "../packages/database/src/index.ts";
import { ADAPTER_ID, policySchema } from "../packages/domain/src/index.ts";
import { PrivyTreasury } from "../packages/privy/src/treasury.ts";
import { loadTestnetSecret } from "../packages/service-config/src/index.ts";

const setupId = z.uuid().parse(process.argv[2]);
const { pool } = connectDatabase();
try {
  const row = (
    await pool.query(
      "select s.*,w.address from wallet_setups s join wallets w on w.id=s.wallet_id where s.id=$1 and s.state='READY'",
      [setupId],
    )
  ).rows[0];
  if (!row) throw new Error("A verified wallet is required.");
  const key = z
    .object({
      publicKey: z.string(),
      privateKey: z.string(),
      purpose: z.literal("PRIVY_ORGANIZATION_AUTHORIZATION"),
    })
    .parse(await loadTestnetSecret(".local/keys/privy-authorization.json"));
  const provider = new PrivyTreasury(
    z.string().parse(process.env.PRIVY_APP_ID),
    z.string().parse(process.env.PRIVY_APP_SECRET),
    key,
  );
  const wallet = {
    id: row.provider_wallet_id,
    address: row.address,
    ownerId: row.owner_id,
    policyIds: [row.provider_policy_id],
  };
  await provider.verify(wallet, row.configuration_json);
  const hash = toHex(1, { size: 32 }),
    account = toHex(1, { size: 20 });
  const policy = policySchema.parse({
    settlementChainId: "5042002",
    escrow: row.configuration_json.escrow,
    organizationId: row.configuration_json.organizationId,
    refundRecipient: row.address,
    sourceChainId: "1",
    sourceVault: account,
    sourceBlockHash: hash,
    fixtureManifestRoot: hash,
    adapterId: ADAPTER_ID,
    adapterCodeHash: hash,
    verifierConfigHash: hash,
    admissionSigner: account,
    verdictSigner: account,
    reportRecipientKeyId: hash,
    asset: ARC_USDC,
    reward: "1000000",
    minimumDiscrepancy: "1000000",
    submissionDeadline: String(Math.floor(Date.now() / 1000) + 86400),
    settlementDeadline: String(Math.floor(Date.now() / 1000) + 90000),
    reservationDurationSeconds: "1800",
    organizationNonce: hash,
  });
  const cases = [
    { name: "allowed", policy },
    { name: "wrong-organization", policy: { ...policy, organizationId: toHex(999, { size: 32 }) } },
    { name: "wrong-asset", policy: { ...policy, asset: account } },
    {
      name: "over-cap",
      policy: { ...policy, reward: (BigInt(row.max_per_action) + 1n).toString() },
    },
  ];
  for (const item of cases) {
    const path = `evidence/privy/treasury-funding-${item.name}-${setupId}.json`;
    try {
      await readFile(path);
      console.log(`${item.name}: saved evidence exists`);
      continue;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const id = randomUUID();
    const evidence = {
      scope: "ARC_TESTNET_SIGNING_ONLY",
      broadcast: false,
      syntheticPolicy: true,
      wallet: wallet.address,
      policyId: row.provider_policy_id,
      case: item.name,
      policy: item.policy,
      idempotencyKey: id,
      checkedAt: new Date().toISOString(),
    };
    await writeFile(path, `${JSON.stringify({ ...evidence, result: "PENDING" }, null, 2)}\n`, {
      flag: "wx",
    });
    try {
      const result = await provider.sign(wallet, id, {
        to: item.policy.escrow,
        data: encodeFunctionData({
          abi: bountyEscrowAbi,
          functionName: "createAndFund",
          args: [contractPolicy(item.policy)],
        }),
        nonce: 0,
        gasLimit: "0x7a120",
        gasPrice: "0x1",
      });
      await writeFile(
        path,
        `${JSON.stringify({ ...evidence, result: "SIGNED_AND_VERIFIED", hash: result.hash }, null, 2)}\n`,
      );
      console.log(`${item.name}: signed`);
      if (item.name !== "allowed") process.exitCode = 1;
    } catch (error) {
      const details = error as { status?: number; error?: { code?: string; error?: string } };
      const providerCode = details.error?.code ?? details.error?.error ?? "UNKNOWN";
      await writeFile(
        path,
        `${JSON.stringify({ ...evidence, result: providerCode === "policy_violation" ? "POLICY_DENIED" : "REQUIRES_REVIEW", providerCode, httpStatus: details.status ?? null }, null, 2)}\n`,
      );
      console.log(`${item.name}: ${providerCode}`);
      if (item.name === "allowed" || providerCode !== "policy_violation") process.exitCode = 1;
    }
  }
} catch {
  console.error("The live funding policy check did not complete.");
  process.exitCode = 1;
} finally {
  await pool.end();
}
