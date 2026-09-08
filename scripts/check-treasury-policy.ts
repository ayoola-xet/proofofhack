import "dotenv/config";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { encodeFunctionData } from "viem";
import { z } from "zod";
import { ARC_USDC } from "../packages/chain/src/arc.ts";
import { connectDatabase } from "../packages/database/src/index.ts";
import { address } from "../packages/domain/src/index.ts";
import { approvalAbi, PrivyTreasury } from "../packages/privy/src/treasury.ts";
import { loadTestnetSecret } from "../packages/service-config/src/index.ts";

const setupId = z.uuid().parse(process.argv[2]);
const recipient = address.parse(process.env.CIRCLE_AGENT_ADDRESS);
const { pool } = connectDatabase();
const evidencePath = `evidence/privy/treasury-signing-policy-${setupId}.json`;
try {
  const setup = (
    await pool.query(
      "select s.*,w.address from wallet_setups s join wallets w on w.id=s.wallet_id where s.id=$1 and s.state='READY'",
      [setupId],
    )
  ).rows[0];
  if (!setup) throw new Error("The verified treasury wallet is required.");
  if (recipient === setup.configuration_json.escrow)
    throw new Error("Use a recipient outside the policy.");
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
  const wallet = {
    id: setup.provider_wallet_id,
    address: setup.address,
    ownerId: setup.owner_id,
    policyIds: [setup.provider_policy_id],
  };
  await provider.verify(wallet, setup.configuration_json);
  await mkdir("evidence/privy", { recursive: true });
  let previous: Record<string, unknown> | undefined;
  try {
    previous = JSON.parse(await readFile(evidencePath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (previous) {
    console.log("A policy check already exists. Inspect its saved result before another attempt.");
  } else {
    const key = randomUUID();
    const evidence = {
      schemaVersion: "1",
      scope: "ARC_TESTNET_ONLY",
      setupId,
      wallet: setup.address,
      providerWalletId: setup.provider_wallet_id,
      policyId: setup.provider_policy_id,
      configuration: setup.configuration_json,
      verifiedAt: new Date().toISOString(),
      deniedAction: {
        method: "eth_signTransaction",
        function: "approve",
        spender: recipient,
        amount: "0",
        idempotencyKey: key,
      },
    };
    await writeFile(
      evidencePath,
      `${JSON.stringify({ ...evidence, result: "PENDING" }, null, 2)}\n`,
      { flag: "wx" },
    );
    try {
      const result = await provider.testBlockedApproval(wallet, recipient, key);
      await writeFile(
        evidencePath,
        `${JSON.stringify({ ...evidence, result: "UNEXPECTED_ACCEPTANCE", hash: result.hash }, null, 2)}\n`,
      );
      process.exitCode = 1;
      console.error(
        "The provider accepted the zero-amount approval. Funding must remain disabled.",
      );
    } catch (error) {
      const response = error as {
        status?: number;
        error?: { code?: string; error?: string; message?: string };
      };
      const providerCode = response.error?.code ?? response.error?.error ?? "UNKNOWN";
      const details = {
        httpStatus: response.status ?? null,
        providerCode,
        providerMessage: response.error?.message ?? null,
      };
      await writeFile(
        evidencePath,
        `${JSON.stringify({ ...evidence, result: providerCode === "policy_violation" ? "POLICY_DENIED" : "REJECTED_REQUIRES_REVIEW", ...details }, null, 2)}\n`,
      );
      console.log(JSON.stringify(details));
    }
  }
  const allowedPath = `evidence/privy/treasury-allowed-signing-${setupId}.json`;
  let allowedExists = false;
  try {
    await readFile(allowedPath, "utf8");
    allowedExists = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (!allowedExists) {
    const key = randomUUID();
    const evidence = {
      schemaVersion: "1",
      scope: "ARC_TESTNET_ONLY",
      setupId,
      wallet: wallet.address,
      policyId: wallet.policyIds[0],
      verifiedAt: new Date().toISOString(),
      broadcast: false,
      action: {
        method: "eth_signTransaction",
        function: "approve",
        spender: setup.configuration_json.escrow,
        amount: "0",
        idempotencyKey: key,
      },
    };
    await writeFile(
      allowedPath,
      `${JSON.stringify({ ...evidence, result: "PENDING" }, null, 2)}\n`,
      { flag: "wx" },
    );
    const result = await provider.sign(wallet, key, {
      to: ARC_USDC,
      data: encodeFunctionData({
        abi: approvalAbi,
        functionName: "approve",
        args: [setup.configuration_json.escrow, 0n],
      }),
      nonce: 0,
      gasLimit: "0x186a0",
      gasPrice: "0x1",
    });
    await writeFile(
      allowedPath,
      `${JSON.stringify({ ...evidence, result: "SIGNED_AND_VERIFIED", hash: result.hash }, null, 2)}\n`,
    );
    console.log(
      "Privy signed the allowed request. Its signer and all transaction fields match. No transaction was broadcast.",
    );
  }
} catch {
  console.error("The treasury policy check did not complete. No secret values are logged.");
  process.exitCode = 1;
} finally {
  await pool.end();
}
