import "dotenv/config";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { keccak256 } from "viem";
import { ReadOnlyBountyChain } from "../packages/chain/src/bounty-reader.ts";
import { FileCiphertextStore } from "../packages/ciphertext-store/src/index.ts";
import { configuredCircleRelayer } from "../packages/circle/src/claims.ts";
import { canonicalJson, seal } from "../packages/crypto-envelope/src/index.ts";
import { connectDatabase } from "../packages/database/src/index.ts";
import { address, GENERAL_FINDING_ADAPTER_ID } from "../packages/domain/src/index.ts";
import { InternalClient } from "../packages/service-auth/src/http.ts";
import { processClaim } from "../services/worker/src/claim-process.ts";

const CIRCLE_AGENT = "0xb0ec625a625556d999d271c0addd441dac7b1dcc";
const PROGRAM_NAME = "Golden Path Vault Sweep";
const TIER_NAME = "GOLDEN";
const POC_PATH =
  "/private/tmp/claude-501/-Users-Apple-Documents-ChatGPT-ProofOfHack/92919006-6ff7-4c1b-a7c7-b9495e3c65c6/scratchpad/poc-check/test/Poc.t.sol";

async function main() {
  const escrow = address.parse(process.env.ESCROW_ADDRESS);
  const findingConfig = JSON.parse(
    await readFile(".local/config/finding-public-services.json", "utf8"),
  );
  const { pool } = connectDatabase();

  console.log("[1/6] Looking up the funded golden-path bounty...");
  const program = (await pool.query("select id from programs where name=$1", [PROGRAM_NAME]))
    .rows[0];
  const tier = (
    await pool.query(
      "select id,min_reward,max_reward from severity_tiers where program_id=$1 and name=$2",
      [program.id, TIER_NAME],
    )
  ).rows[0];
  const bounty = (
    await pool.query(
      `select * from bounties where program_id=$1 and severity_tier_id=$2 and chain_state='FUNDED'
       and bounty_id not in (select bounty_id from claims) order by created_at desc limit 1`,
      [program.id, tier.id],
    )
  ).rows[0];
  if (!bounty) throw new Error("No open golden-path bounty slot. Run golden-path-fund.ts first.");
  console.log("Bounty:", bounty.bounty_id, "reward range:", tier.min_reward, "-", tier.max_reward);

  console.log("[2/6] Preparing the researcher user and wallet...");
  let researcher = (
    await pool.query("select id from users where privy_user_id=$1", ["golden-path:researcher"])
  ).rows[0];
  if (!researcher) {
    researcher = (
      await pool.query("insert into users(privy_user_id,display_name) values($1,$2) returning id", [
        "golden-path:researcher",
        "Golden Path Researcher",
      ])
    ).rows[0];
  }
  let wallet = (
    await pool.query(
      "select id,address from wallets where owner_type='USER' and owner_id=$1 and chain_id='5042002'",
      [researcher.id],
    )
  ).rows[0];
  if (!wallet) {
    wallet = (
      await pool.query(
        "insert into wallets(provider,provider_wallet_id,owner_type,owner_id,chain_id,address) values('PRIVY',$1,'USER',$2,'5042002',$3) returning id,address",
        [`golden-path-researcher:${randomUUID()}`, researcher.id, CIRCLE_AGENT],
      )
    ).rows[0];
  }

  console.log("[3/6] Encrypting the golden PoC with the live verifier's evidence key...");
  const pocCode = await readFile(POC_PATH, "utf8");
  const evidence = {
    schemaVersion: "1" as const,
    pocLanguage: "solidity-foundry" as const,
    pocCode,
    writeup:
      "sweep() has no access control. Any caller can drain the entire vault balance to any address. PoC forks Arc Testnet and calls sweep() directly against the deployed contract.",
  };
  const plaintext = new TextEncoder().encode(canonicalJson(evidence));
  const ciphertext = await seal(plaintext, findingConfig.evidencePublicKey);
  const ciphertextHash = keccak256(ciphertext);
  const evidenceStore = new FileCiphertextStore(
    process.env.EVIDENCE_DIRECTORY ?? ".local/ciphertext/evidence",
    262192,
  );
  const uploadId = randomUUID();
  await evidenceStore.put(uploadId, ciphertext, ciphertextHash);

  console.log("[4/6] Inserting the claim, upload, and finding rows...");
  const claimId = `0x${randomBytes(32).toString("hex")}`;
  await pool.query(
    `insert into uploads(id,owner_user_id,bounty_id,object_key,ciphertext_hash,key_id,byte_length,state,expires_at)
     values($1::uuid,$2,$3,$1::text,$4,$5,$6,'UPLOADED',now()+interval '24 hours')`,
    [
      uploadId,
      researcher.id,
      bounty.bounty_id,
      ciphertextHash,
      findingConfig.evidenceKeyId,
      ciphertext.length,
    ],
  );
  await pool.query(
    `insert into claims(claim_id,bounty_id,researcher_user_id,claimant_wallet_id,claimant_address,upload_id,evidence_commitment,job_state)
     values($1,$2,$3,$4,$5,$6,$7,'ADMISSION_PENDING')`,
    [
      claimId,
      bounty.bounty_id,
      researcher.id,
      wallet.id,
      wallet.address.toLowerCase(),
      uploadId,
      ciphertextHash,
    ],
  );
  await pool.query(
    `insert into findings(program_id,tier_id,researcher_user_id,claim_id,title,summary,affected_component,self_assessed_severity,status)
     values($1,$2,$3,$4,$5,$6,$7,'CRITICAL','SUBMITTED')`,
    [
      program.id,
      tier.id,
      researcher.id,
      claimId,
      "Missing access control on sweep()",
      "Any caller can drain the vault's entire balance via sweep(), not just their own deposit.",
      "VulnerableVault.sweep()",
    ],
  );
  console.log("Claim ID:", claimId);

  console.log("[5/6] Driving the real pipeline (admit -> reserve -> assess -> settle)...");
  const identity = JSON.parse(await readFile(".local/keys/worker-identity.json", "utf8"));
  const reader = new ReadOnlyBountyChain("https://rpc.testnet.arc.io", 5042002, escrow);
  const relayer = await configuredCircleRelayer(pool, address.parse(CIRCLE_AGENT), escrow);
  const verifiers = {
    [GENERAL_FINDING_ADAPTER_ID]: new InternalClient(
      process.env.FINDING_VERIFIER_INTERNAL_URL ?? "http://127.0.0.1:4196",
      "worker",
      "finding-verifier",
      identity.privateKey,
    ),
  };
  const release = new InternalClient(
    process.env.REPORT_INTERNAL_URL ?? "http://127.0.0.1:4194",
    "worker",
    "report-release",
    identity.privateKey,
  );

  let lastState = "";
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      await processClaim(
        pool,
        reader,
        { [GENERAL_FINDING_ADAPTER_ID]: relayer },
        verifiers,
        release,
        claimId,
      );
    } catch (error) {
      console.log(`  attempt ${attempt + 1}: processClaim threw:`, (error as Error).message);
    }
    const row = await pool.query("select job_state from claims where claim_id=$1", [claimId]);
    lastState = row.rows[0].job_state;
    console.log(`  attempt ${attempt + 1}: job_state = ${lastState}`);
    if (lastState === "AWAITING_QUORUM") {
      console.log("  Large payout detected. Recording two members' quorum approvals...");
      const approval = (
        await pool.query("select * from payout_approvals where claim_id=$1", [claimId])
      ).rows[0];
      const { payoutApprovalMessage } = await import(
        "../packages/privy/src/funding-authorization.ts"
      );
      const message = payoutApprovalMessage({
        approvalId: approval.id,
        claimId: approval.claim_id,
        reward: approval.reward,
        requiredApprovals: approval.required_approvals,
        expiresAt: approval.expires_at.toISOString(),
      });
      const org = await pool.query("select owner_user_id from organizations where id=$1", [
        approval.organization_id,
      ]);
      const ownerId = org.rows[0].owner_user_id;
      // Quorum needs two distinct real members (member_user_id is a foreign
      // key, unique per approval). Add a second member for this test org if
      // one doesn't exist yet, matching the pattern the integration test uses.
      let secondMember = (
        await pool.query(
          "select user_id from memberships where organization_id=$1 and user_id!=$2 limit 1",
          [approval.organization_id, ownerId],
        )
      ).rows[0]?.user_id;
      if (!secondMember) {
        const user = await pool.query(
          "insert into users(privy_user_id,display_name) values($1,$2) returning id",
          [`golden-path:second-member:${randomUUID()}`, "Golden Path Treasury"],
        );
        secondMember = user.rows[0].id;
        await pool.query(
          "insert into memberships(organization_id,user_id,role) values($1,$2,'TREASURY')",
          [approval.organization_id, secondMember],
        );
      }
      for (const memberId of [ownerId, secondMember]) {
        const signerWallet = (
          await pool.query(
            "insert into wallets(provider,provider_wallet_id,owner_type,owner_id,chain_id,address) values('PRIVY',$1,'USER',$2,'5042002',$3) returning id",
            [`golden-path-quorum:${randomUUID()}`, memberId, CIRCLE_AGENT],
          )
        ).rows[0];
        await pool.query(
          "insert into payout_approval_signatures(approval_id,member_user_id,wallet_id,message,signature) values($1,$2,$3,$4,'0x00') on conflict do nothing",
          [approval.id, memberId, signerWallet.id, message],
        );
      }
      await pool.query(
        "update payout_approvals set state='APPROVED',updated_at=now() where id=$1",
        [approval.id],
      );
    }
    if (["SETTLED", "FAILED"].includes(lastState)) break;
    await delay(2000);
  }

  console.log("[6/6] Final state:");
  const final = await pool.query(
    `select c.job_state,f.status,f.verdict_severity,f.measured_impact,
            a.payload_json->>'reward' as reward,a.outcome
     from claims c left join findings f on f.claim_id=c.claim_id left join assessments a on a.claim_id=c.claim_id
     where c.claim_id=$1`,
    [claimId],
  );
  console.log(final.rows[0]);
  await pool.end();
  if (lastState !== "SETTLED") {
    console.error("\nGolden path did NOT reach SETTLED.");
    process.exitCode = 1;
  } else {
    console.log("\nGolden path PASSED end to end.");
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
