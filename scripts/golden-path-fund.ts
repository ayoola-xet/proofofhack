import "dotenv/config";
import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { toFunctionSignature } from "viem";
import { connectDatabase } from "../packages/database/src/index.ts";
import {
  address,
  GENERAL_FINDING_ADAPTER_ID,
  hashPolicy,
  NO_FIXTURE_MANIFEST_ROOT,
  organizationHash,
  policySchema,
} from "../packages/domain/src/index.ts";
import { ARC_USDC } from "../packages/chain/src/arc.ts";
import { bountyEscrowAbi } from "../packages/chain/src/abi/BountyEscrow.ts";
import { InternalClient } from "../packages/service-auth/src/http.ts";

const execute = promisify(execFile);
const VULNERABLE_VAULT = "0xa37f932710268fe0b04d24369737f6999f991733";
const CIRCLE_AGENT = "0xb0ec625a625556d999d271c0addd441dac7b1dcc";
const ORG_NAME = "ProofOfHack QA";
const PROGRAM_NAME = "Golden Path Vault Sweep";
const TIER_NAME = "GOLDEN";
const REWARD = "3000000"; // 3 test USDC

async function circleExecute(fn: string, params: string[], contract: string) {
  const { stdout } = await execute(
    "pnpm",
    [
      "exec",
      "circle",
      "wallet",
      "execute",
      fn,
      ...params,
      "--contract",
      contract,
      "--address",
      CIRCLE_AGENT,
      "--chain",
      "ARC-TESTNET",
      "--amount",
      "0",
      "--idempotency-key",
      randomUUID(),
      "--output",
      "json",
    ],
    { maxBuffer: 1024 * 1024, timeout: 120000 },
  );
  return JSON.parse(stdout).data;
}

async function main() {
  const escrow = address.parse(process.env.ESCROW_ADDRESS);
  const findingConfig = JSON.parse(
    await readFile(".local/config/finding-public-services.json", "utf8"),
  );
  const { pool } = connectDatabase();

  console.log("[1/4] Setting up organization, program, and severity tier...");
  let org = (
    await pool.query(
      "select id,onchain_id,owner_user_id from organizations where name=$1",
      [ORG_NAME],
    )
  ).rows[0];
  if (!org) {
    const user = await pool.query(
      "insert into users(privy_user_id,display_name) values($1,$2) returning id",
      [`golden-path:${randomUUID()}`, ORG_NAME],
    );
    const orgId = randomUUID();
    org = (
      await pool.query(
        "insert into organizations(id,onchain_id,name,owner_user_id) values($1,$2,$3,$4) returning id,onchain_id,owner_user_id",
        [orgId, organizationHash(orgId), ORG_NAME, user.rows[0].id],
      )
    ).rows[0];
    await pool.query(
      "insert into memberships(organization_id,user_id,role) values($1,$2,'OWNER')",
      [org.id, org.owner_user_id],
    );
  }
  let program = (
    await pool.query("select id from programs where name=$1", [PROGRAM_NAME])
  ).rows[0];
  if (!program) {
    program = (
      await pool.query(
        `insert into programs(organization_id,name,kind,scope_summary,rules_summary,disclosure_policy,visibility,status)
         values($1,$2,'FINDINGS',$3,$4,$5,'PUBLIC','ACTIVE') returning id`,
        [
          org.id,
          PROGRAM_NAME,
          "VulnerableVault, a real contract deployed on Arc Testnet holding live test USDC TVL. This program exists to prove ProofOfHack's automated verification pipeline end-to-end against a genuine, exploitable bug (a missing access-control check on sweep()), not a fabricated one.",
          "A qualifying finding must include a Foundry proof of concept that actually calls the deployed VulnerableVault and demonstrably moves funds out of it to an address the caller controls.",
          "This is a permanent regression-test program for the platform itself.",
        ],
      )
    ).rows[0];
  }
  let tier = (
    await pool.query("select id from severity_tiers where program_id=$1 and name=$2", [
      program.id,
      TIER_NAME,
    ])
  ).rows[0];
  if (!tier) {
    tier = (
      await pool.query(
        "insert into severity_tiers(program_id,name,min_reward,max_reward,asset,display_order) values($1,$2,'1000000',$3,'',0) returning id",
        [program.id, TIER_NAME, REWARD],
      )
    ).rows[0];
  }

  console.log("[2/4] Fetching organization report key...");
  let orgKey = (
    await pool.query(
      "select key_id from organization_keys where organization_id=$1 and status='ACTIVE'",
      [org.id],
    )
  ).rows[0];
  if (!orgKey) {
    // The report-release service owns key generation; call its internal endpoint
    // the same way the API's report-key route does, instead of instantiating a
    // separate OrganizationKeyStore that could point at a different directory.
    const apiIdentity = JSON.parse(await readFile(".local/keys/api-identity.json", "utf8"));
    const release = new InternalClient(
      process.env.REPORT_INTERNAL_URL ?? "http://127.0.0.1:4194",
      "api",
      "report-release",
      apiIdentity.privateKey,
    );
    const key = await release.post<{ keyId: string; publicKey: string }>(
      "/internal/organization-keys",
      { organizationId: org.id, actorId: org.owner_user_id },
    );
    orgKey = { key_id: key.keyId };
  }

  console.log("[3/4] Building and funding the bounty policy on Arc Testnet...");
  const blockHashResult = await execute("cast", [
    "block",
    "latest",
    "--rpc-url",
    "https://rpc.testnet.arc.io",
    "--field",
    "hash",
  ]);
  const sourceBlockHash = blockHashResult.stdout.trim();
  const now = Math.floor(Date.now() / 1000);
  const policy = policySchema.parse({
    settlementChainId: "5042002",
    escrow,
    organizationId: org.onchain_id,
    refundRecipient: CIRCLE_AGENT.toLowerCase(),
    sourceChainId: "5042002",
    sourceVault: VULNERABLE_VAULT,
    sourceBlockHash,
    fixtureManifestRoot: NO_FIXTURE_MANIFEST_ROOT,
    adapterId: GENERAL_FINDING_ADAPTER_ID,
    adapterCodeHash: findingConfig.adapterCodeHash,
    verifierConfigHash: findingConfig.verifierConfigHash,
    admissionSigner: findingConfig.admissionSigner,
    verdictSigner: findingConfig.verdictSigner,
    reportRecipientKeyId: orgKey.key_id,
    asset: ARC_USDC,
    reward: REWARD,
    minimumDiscrepancy: "1",
    submissionDeadline: String(now + 30 * 86400),
    settlementDeadline: String(now + 30 * 86400 + 1800 + 3600),
    reservationDurationSeconds: "1800",
    organizationNonce: `0x${randomBytes(32).toString("hex")}`,
  });
  const bountyId = hashPolicy(policy);
  const existingBounty = await pool.query("select bounty_id from bounties where bounty_id=$1", [
    bountyId,
  ]);
  if (existingBounty.rows.length > 0) {
    console.log("Bounty already funded:", bountyId);
    await pool.end();
    return;
  }

  const entry = bountyEscrowAbi.find(
    (e) => e.type === "function" && e.name === "createAndFund",
  );
  if (entry?.type !== "function") throw new Error("Missing createAndFund ABI entry.");
  const tuple = entry.inputs[0];
  if (!tuple || !("components" in tuple)) throw new Error("Missing tuple components.");
  const values = tuple.components.map((field) => (policy as Record<string, string>)[field.name]);

  await circleExecute("approve(address,uint256)", [escrow, REWARD], ARC_USDC);
  console.log("Approved escrow to pull the reward.");
  const funded = await circleExecute(
    toFunctionSignature(entry),
    [JSON.stringify(values)],
    escrow,
  );
  console.log("Funded on-chain:", funded.txHash);

  console.log("[4/4] Recording the funded bounty...");
  await pool.query(
    `insert into bounties(bounty_id,program_id,severity_tier_id,policy_hash,policy_json,chain_id,escrow,reward,unallocated_reward,chain_state,creation_tx)
     values($1,$2,$3,$1,$4,'5042002',$5,$6,$6,'FUNDED',$7)`,
    [bountyId, program.id, tier.id, JSON.stringify(policy), escrow, REWARD, funded.txHash],
  );
  console.log("\nDone. Bounty ID:", bountyId);
  console.log("Program ID:", program.id, "Tier ID:", tier.id);
  await pool.end();
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
