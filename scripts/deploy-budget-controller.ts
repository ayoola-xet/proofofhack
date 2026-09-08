import "dotenv/config";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { type Hex, keccak256, parseUnits } from "viem";
import { z } from "zod";
import { ARC_USDC, arcClient } from "../packages/chain/src/arc.ts";
import { ReadOnlyBudgetChain } from "../packages/chain/src/budget.ts";
import bytecode from "../packages/chain/src/bytecode/FundingBudgetController.json";
import { configuredCircleRelayer, runCircle } from "../packages/circle/src/claims.ts";
import { connectDatabase } from "../packages/database/src/index.ts";
import { address, bytes32 } from "../packages/domain/src/index.ts";
import { first } from "../services/api/src/context.ts";
import { registerController } from "../services/budget/src/controllers.ts";

const resultSchema = z.object({
  id: z.string(),
  idempotencyKey: z.uuid(),
  blockchain: z.literal("ARC-TESTNET"),
  txHash: bytes32,
  sourceAddress: address,
  contractAddress: address,
});
const intentSchema = z.object({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  organizationId: z.uuid(),
  ownerWalletId: z.uuid(),
  owner: address,
  operator: address,
  escrow: address,
  onchainId: bytes32,
  bytecodeHash: bytes32,
  result: resultSchema.optional(),
});
const orgId = z.uuid().parse(process.argv[2]);
if (!["local", "arc-testnet"].includes(process.env.APP_ENV ?? "local"))
  throw new Error("Controller deployment requires a testnet environment.");
const operator = address.parse(process.env.CIRCLE_AGENT_ADDRESS),
  escrow = address.parse(process.env.ESCROW_ADDRESS),
  client = arcClient(),
  { pool } = connectDatabase();
const directory = ".local/deployment-intents",
  path = `${directory}/controller-${orgId}.json`;
await mkdir(directory, { recursive: true, mode: 0o700 });
const save = async (intent: z.infer<typeof intentSchema>) => {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(intent, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await rename(temporary, path);
};
const c = await pool.connect();
try {
  if ((await client.getChainId()) !== 5042002) throw new Error("Deployment requires Arc Testnet.");
  const locked = (
    await c.query("select pg_try_advisory_lock(hashtextextended($1,0)) as locked", [
      `controller-deploy:${orgId}`,
    ])
  ).rows[0].locked;
  if (!locked) throw new Error("This controller deployment is already in progress.");
  const org = await first(
    c,
    "select id,onchain_id from organizations where id=$1 and status='ACTIVE'",
    [orgId],
  );
  const owner = await first(
    c,
    "select w.id,w.address from wallets w join wallet_setups s on s.wallet_id=w.id where w.owner_type='ORGANIZATION' and w.owner_id=$1 and w.provider='PRIVY' and w.chain_id='5042002' and s.state='READY'",
    [orgId],
  );
  const wallet = await configuredCircleRelayer(pool, operator, escrow);
  const inputs = {
    organizationId: orgId,
    ownerWalletId: owner.id,
    owner: address.parse(owner.address),
    operator,
    escrow,
    onchainId: bytes32.parse(org.onchain_id),
    bytecodeHash: keccak256(bytecode.creationBytecode as Hex),
  };
  let intent: z.infer<typeof intentSchema>;
  try {
    intent = intentSchema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    if (
      (
        await c.query(
          "select id from budget_controllers where organization_id=$1 and chain_id='5042002'",
          [orgId],
        )
      ).rowCount
    )
      throw new Error("A controller is already registered. Use its saved deployment record.");
    intent = { ...inputs, id: randomUUID(), createdAt: new Date().toISOString() };
    await writeFile(path, `${JSON.stringify(intent, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  }
  if (Object.entries(inputs).some(([key, value]) => intent[key as keyof typeof inputs] !== value))
    throw new Error("The saved controller deployment has different inputs.");
  const args = [
    "contract",
    "deploy",
    "--bytecode",
    bytecode.creationBytecode,
    "--address",
    operator,
    "--chain",
    "ARC-TESTNET",
    "--constructor-signature",
    "constructor(address,address,bytes32,address)",
    inputs.owner,
    operator,
    inputs.onchainId,
    escrow,
  ];
  if (!intent.result) {
    if (Date.now() - Date.parse(intent.createdAt) > 23 * 3600000)
      throw new Error("The saved deployment needs provider reconciliation before retry.");
    const estimate = z
      .object({
        blockchain: z.literal("ARC-TESTNET"),
        medium: z.object({ networkFee: z.string().regex(/^\d+(\.\d{1,18})?$/) }),
      })
      .parse(await runCircle([...args, "--estimate"]));
    const fee = parseUnits(estimate.medium.networkFee, 18);
    if (
      fee > parseUnits("0.5", 18) ||
      (await client.getBalance({ address: operator })) < fee + parseUnits("0.1", 18)
    )
      throw new Error("The testnet deployment estimate exceeds the fee or gas reserve limit.");
    process.stdout.write("The testnet fee estimate is within the deployment limit.\n");
    const result = resultSchema.parse(await runCircle([...args, "--idempotency-key", intent.id]));
    if (result.idempotencyKey !== intent.id || result.sourceAddress !== operator)
      throw new Error("The deployment provider returned a different request or wallet.");
    intent = { ...intent, result };
    await save(intent);
  }
  const result = intent.result;
  if (!result) throw new Error("The deployment result is missing.");
  const reader = new ReadOnlyBudgetChain("https://rpc.testnet.arc.io", 5042002, escrow);
  await c.query("begin");
  const controller = await registerController(
    c,
    reader,
    {
      organizationId: orgId,
      ownerWalletId: owner.id,
      operatorWalletId: wallet.walletId,
      address: result.contractAddress,
      deploymentHash: result.txHash,
    },
    { chainId: 5042002, asset: ARC_USDC, escrow, operator },
  );
  await c.query("commit");
  const evidence = {
    capturedAt: new Date().toISOString(),
    network: "Arc Testnet",
    chainId: 5042002,
    organizationId: orgId,
    controllerId: controller.id,
    address: controller.address,
    owner: inputs.owner,
    operator,
    asset: ARC_USDC,
    escrow,
    enabled: controller.enabled,
    projection: controller.limit_projection_json,
    provider: "Circle Agent Stack",
    deploymentOnly: true,
  };
  await mkdir("evidence/arc", { recursive: true });
  await writeFile(
    `evidence/arc/controller-${orgId}.json`,
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  process.stdout.write(
    "The controller deployment and registration are verified. No allocation was requested.\n",
  );
} catch (error) {
  await c.query("rollback");
  process.stderr.write(
    error instanceof Error ? `${error.message}\n` : "Controller setup needs review.\n",
  );
  process.exitCode = 1;
} finally {
  await c.query("select pg_advisory_unlock(hashtextextended($1,0))", [
    `controller-deploy:${orgId}`,
  ]);
  c.release();
  await pool.end();
}
