import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { z } from "zod";
import { type OwnerCommand, ownerCall } from "../packages/chain/src/owner-command.ts";
import { connectDatabase } from "../packages/database/src/index.ts";
import { ownerPermissionRules } from "../packages/privy/src/owner-permission.ts";
import { canonicalTreasuryRules, PrivyTreasury } from "../packages/privy/src/treasury.ts";
import { loadTestnetSecret } from "../packages/service-config/src/index.ts";
import { ownerContext } from "../services/budget/src/owner-context.ts";

if (!["local", "arc-testnet"].includes(process.env.APP_ENV ?? "local"))
  throw new Error("This check requires a testnet environment.");
const controllerId = z.uuid().parse(process.argv[2]),
  testCase = z
    .enum(["enabled", "limits", "deposit", "withdraw", "approval"])
    .parse(process.argv[3] ?? "enabled"),
  { pool } = connectDatabase(),
  c = await pool.connect();
let lock: string | undefined;
try {
  const { controller, binding, config, wallet, setup } = await ownerContext(c, controllerId);
  if (setup.state !== "READY") throw new Error("The owner wallet is not ready.");
  lock = `treasury-wallet:${controller.owner_wallet_id}`;
  if (
    !(await c.query("select pg_try_advisory_lock(hashtextextended($1,0)) as locked", [lock]))
      .rows[0].locked
  ) {
    lock = undefined;
    throw new Error("The owner wallet is busy.");
  }
  if (
    (
      await c.query(
        "select id from owner_requests where wallet_id=$1 and state not in('COMPLETE','CANCELLED','EXPIRED','FAILED') union all select id from transaction_intents where wallet_id=$1 and state not in('CONFIRMED','FAILED')",
        [controller.owner_wallet_id],
      )
    ).rowCount
  )
    throw new Error("Complete the wallet's pending actions before this check.");
  const key = z
    .object({
      publicKey: z.string(),
      privateKey: z.string(),
      purpose: z.literal("PRIVY_ORGANIZATION_AUTHORIZATION"),
    })
    .parse(await loadTestnetSecret(".local/keys/privy-authorization.json"));
  const provider = new PrivyTreasury(
    z.string().min(1).parse(process.env.PRIVY_APP_ID),
    z.string().min(1).parse(process.env.PRIVY_APP_SECRET),
    key,
  );
  const path = `evidence/privy/owner-policy-${controllerId}-${testCase}.json`;
  await mkdir("evidence/privy", { recursive: true });
  let record: {
    id: string;
    expiresAt: string;
    result: string;
    allowed?: string;
    blocked?: string;
    restored?: boolean;
    stage?: string;
    failureCode?: string;
    httpStatus?: number;
    ruleHash?: string;
  };
  try {
    record = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    record = {
      id: randomUUID(),
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      result: "PENDING",
    };
    await writeFile(path, JSON.stringify(record), { flag: "wx" });
  }
  const commands: Record<typeof testCase, [OwnerCommand, OwnerCommand]> = {
    enabled: [
      { kind: "SET_ENABLED", enabled: false },
      { kind: "SET_ENABLED", enabled: false },
    ],
    limits: [
      { kind: "SET_LIMITS", perAction: "1000000", daily: "3000000", interval: 60 },
      { kind: "SET_LIMITS", perAction: "2000000", daily: "3000000", interval: 60 },
    ],
    deposit: [
      { kind: "DEPOSIT", amount: "1" },
      { kind: "DEPOSIT", amount: "2" },
    ],
    withdraw: [
      { kind: "WITHDRAW", amount: "1" },
      { kind: "WITHDRAW", amount: "2" },
    ],
    approval: [
      {
        kind: "APPROVE_POLICY",
        draftId: "00000000-0000-4000-8000-000000000001",
        policyHash: `0x${"1".repeat(64)}`,
        reward: "1",
        expiresAt: "1800000000",
      },
      {
        kind: "APPROVE_POLICY",
        draftId: "00000000-0000-4000-8000-000000000001",
        policyHash: `0x${"1".repeat(64)}`,
        reward: "2",
        expiresAt: "1800000000",
      },
    ],
  };
  const [allowedCommand, blockedCommand] = commands[testCase];
  const permission = {
    controller: binding.address,
    command: allowedCommand,
    expiresAt: record.expiresAt,
  };
  await provider.restoreOwnerPermission(wallet, config, permission);
  if (process.argv[4] === "--new-attempt") {
    await mkdir("evidence/privy/owner-policy-attempts", { recursive: true });
    await rename(path, `evidence/privy/owner-policy-attempts/${record.id}.json`);
    record = {
      id: randomUUID(),
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      result: "PENDING",
    };
    permission.expiresAt = record.expiresAt;
    await writeFile(path, JSON.stringify(record), { flag: "wx" });
  }
  const ruleHash = createHash("sha256")
    .update(canonicalTreasuryRules(ownerPermissionRules(config, permission)))
    .digest("hex");
  if (record.result === "PASS") {
    if (record.ruleHash !== ruleHash)
      throw new Error("Use --new-attempt to verify the current rule version.");
    process.stdout.write(
      "The saved owner policy evidence exists. The base wallet policy is verified.\n",
    );
  } else {
    try {
      delete record.failureCode;
      delete record.httpStatus;
      delete record.allowed;
      delete record.blocked;
      record.restored = false;
      record.ruleHash = ruleHash;
      record.stage = "SET_PERMISSION";
      await writeFile(path, `${JSON.stringify(record, null, 2)}\n`);
      await provider.setOwnerPermission(wallet, config, permission);
      const allowed = ownerCall(binding.address, permission.command),
        blocked = ownerCall(
          testCase === "enabled" ? binding.owner : binding.address,
          blockedCommand,
        );
      record.stage = "SIGN_ALLOWED";
      await provider.sign(wallet, `${record.id}:allowed`, {
        ...allowed,
        nonce: 0,
        gasLimit: "0x186a0",
        gasPrice: "0x1",
      });
      record.allowed = "SIGNED_AND_VERIFIED";
      record.stage = "SIGN_BLOCKED";
      try {
        await provider.sign(wallet, `${record.id}:blocked`, {
          ...blocked,
          nonce: 0,
          gasLimit: "0x186a0",
          gasPrice: "0x1",
        });
        record.blocked = "UNEXPECTEDLY_SIGNED";
      } catch (error) {
        const details = error as { error?: { code?: string; error?: string } };
        record.blocked =
          (details.error?.code ?? details.error?.error) === "policy_violation"
            ? "POLICY_DENIED"
            : "REQUIRES_REVIEW";
      }
      record.result =
        record.allowed === "SIGNED_AND_VERIFIED" && record.blocked === "POLICY_DENIED"
          ? "PASS"
          : "FAIL";
    } catch (error) {
      const details = error as {
        status?: number;
        code?: string;
        error?: { code?: string; error?: string; message?: string };
      };
      const code = details.error?.code ?? details.error?.error ?? details.code;
      record.result = "FAIL";
      record.failureCode =
        typeof code === "string" && /^[a-zA-Z_]{1,80}$/.test(code)
          ? code
          : "UNCLASSIFIED_PROVIDER_ERROR";
      record.httpStatus = details.status;
      if (typeof details.error?.message === "string") {
        process.stderr.write(`${details.error.message.slice(0, 1000)}\n`);
      }
      throw error;
    } finally {
      await provider.restoreOwnerPermission(wallet, config, permission);
      record.restored = true;
      await writeFile(
        path,
        `${JSON.stringify({ ...record, checkedAt: new Date().toISOString(), scope: "ARC_TESTNET_PROVIDER_POLICY_TEST", broadcast: false, ownerUserConfirmation: false, controller: binding.address, wallet: binding.owner, policyId: wallet.policyIds[0], allowedCommand, blockedCommand, blockedDestination: testCase === "enabled" ? binding.owner : ownerCall(binding.address, blockedCommand).to, parameterEnforcement: testCase === "enabled" ? "APPLICATION_SIGNED_CONFIRMATION" : "PRIVY_EXACT_ARGUMENTS" }, null, 2)}\n`,
      );
    }
    if (record.result !== "PASS") throw new Error("The owner policy check needs review.");
    process.stdout.write(
      `${testCase}: Privy signs the allowed action and rejects the prohibited action. The base policy is restored. No transaction was broadcast.\n`,
    );
  }
} catch {
  process.stderr.write(
    "The live owner policy check did not complete. Check its saved evidence and restore the base policy before wallet use.\n",
  );
  process.exitCode = 1;
} finally {
  if (lock) await c.query("select pg_advisory_unlock(hashtextextended($1,0))", [lock]);
  c.release();
  await pool.end();
}
