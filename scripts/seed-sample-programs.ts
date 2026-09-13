import "dotenv/config";
import { randomUUID } from "node:crypto";
import { connectDatabase } from "../packages/database/src/index.ts";
import { organizationHash } from "../packages/domain/src/index.ts";

const ASSET = "0x3600000000000000000000000000000000000000";

const TIERS = [
  { name: "CRITICAL", minReward: "50000000000", maxReward: "250000000000", displayOrder: 0 },
  { name: "HIGH", minReward: "10000000000", maxReward: "50000000000", displayOrder: 1 },
  { name: "MEDIUM", minReward: "2000000000", maxReward: "10000000000", displayOrder: 2 },
  { name: "LOW", minReward: "500000000", maxReward: "2000000000", displayOrder: 3 },
];

const PROGRAMS = [
  {
    organization: "Meridian Lending",
    program: "Meridian Lending Core",
    scopeSummary:
      "Lending pool, interest rate model, and liquidation engine deployed on Arc. In-scope contracts: LendingPool, InterestRateModel, LiquidationManager, and the Circle-agent funded settlement path.",
    rulesSummary:
      "Findings must include a working proof of concept demonstrating fund loss, insolvency, or bypass of the liquidation threshold. Denial-of-service reports need a measured impact, not a theoretical one.",
    disclosurePolicy:
      "Do not disclose a finding publicly until the reward has settled on Arc and the organization confirms remediation.",
  },
  {
    organization: "Solace Vaults",
    program: "Solace ERC-4626 Vaults",
    scopeSummary:
      "ERC-4626 yield vaults indexed live by The Graph, including share pricing, deposit and withdrawal accounting, and strategy adapters.",
    rulesSummary:
      "Share-price manipulation, rounding exploits, and strategy adapter fund extraction are in scope. UI-only issues and gas griefing without fund impact are out of scope.",
    disclosurePolicy:
      "Reports stay confidential until payout settles and the vault operator ships a fix or mitigation.",
  },
  {
    organization: "Nimbus Bridge",
    program: "Nimbus Cross-Chain Messaging",
    scopeSummary:
      "Cross-chain message verification and relayer contracts bridging assets onto Arc. In scope: message authentication, replay protection, and relayer authorization.",
    rulesSummary:
      "Message forgery, replay across chains, or relayer impersonation qualify at CRITICAL. Findings must show an executable exploit path, not a code smell.",
    disclosurePolicy: "No public disclosure before payout settlement and organization sign-off.",
  },
  {
    organization: "Vector DEX",
    program: "Vector AMM",
    scopeSummary:
      "Automated market maker pools, fee accounting, and router contracts. Includes the price oracle used for external integrations.",
    rulesSummary:
      "Price manipulation, fee accounting drift, and router fund-draining paths are in scope. Front-running that does not extract protocol funds is out of scope.",
    disclosurePolicy: "Embargo findings until the researcher is paid and the fix ships.",
  },
];

async function main() {
  const { pool } = connectDatabase();
  try {
    for (const entry of PROGRAMS) {
      const existing = await pool.query("select id from programs where name=$1", [entry.program]);
      if (existing.rows.length > 0) {
        process.stdout.write(`Skipping "${entry.program}" (already exists).\n`);
        continue;
      }
      const user = await pool.query(
        "insert into users(privy_user_id,display_name) values($1,$2) returning id",
        [`sample:${randomUUID()}`, `${entry.organization} team`],
      );
      const orgId = randomUUID();
      await pool.query(
        "insert into organizations(id,onchain_id,name,owner_user_id) values($1,$2,$3,$4)",
        [orgId, organizationHash(orgId), entry.organization, user.rows[0].id],
      );
      const program = await pool.query(
        `insert into programs(organization_id,name,kind,scope_summary,rules_summary,disclosure_policy,visibility,status)
         values($1,$2,'FINDINGS',$3,$4,$5,'PUBLIC','ACTIVE') returning id`,
        [orgId, entry.program, entry.scopeSummary, entry.rulesSummary, entry.disclosurePolicy],
      );
      for (const tier of TIERS)
        await pool.query(
          "insert into severity_tiers(program_id,name,min_reward,max_reward,asset,display_order) values($1,$2,$3,$4,$5,$6)",
          [program.rows[0].id, tier.name, tier.minReward, tier.maxReward, ASSET, tier.displayOrder],
        );
      process.stdout.write(`Created "${entry.program}" with ${TIERS.length} severity tiers.\n`);
    }
  } finally {
    await pool.end();
  }
}
await main();
