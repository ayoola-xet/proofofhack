import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { toHex } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectDatabase } from "../packages/database/src/index.ts";
import { releaseReport, reportAccess } from "../services/report-release/src/access.ts";

const { pool } = connectDatabase();
let c: PoolClient;
const ids = {
  owner: randomUUID(),
  researcher: randomUUID(),
  other: randomUUID(),
  org: randomUUID(),
  program: randomUUID(),
  wallet: randomUUID(),
  upload: randomUUID(),
  report: randomUUID(),
  event: randomUUID(),
};
const bounty = toHex(BigInt(`0x${randomUUID().replaceAll("-", "")}`), { size: 32 });
const claim = toHex(BigInt(`0x${randomUUID().replaceAll("-", "")}`), { size: 32 });
const address = toHex(4, { size: 20 });
const asset = toHex(5, { size: 20 });
const escrow = toHex(6, { size: 20 });
const hash = toHex(1, { size: 32 });
beforeAll(async () => {
  c = await pool.connect();
  await c.query("begin");
  for (const id of [ids.owner, ids.researcher, ids.other])
    await c.query("insert into users(id,privy_user_id,display_name) values($1,$2,'Report test')", [
      id,
      `local:report:${id}`,
    ]);
  await c.query(
    "insert into organizations(id,onchain_id,name,owner_user_id) values($1,$2,'Report test',$3)",
    [ids.org, bounty, ids.owner],
  );
  await c.query("insert into memberships(organization_id,user_id,role) values($1,$2,'OWNER')", [
    ids.org,
    ids.owner,
  ]);
  await c.query("insert into programs(id,organization_id,name) values($1,$2,'Report test')", [
    ids.program,
    ids.org,
  ]);
  await c.query(
    "insert into wallets(id,provider,provider_wallet_id,owner_type,owner_id,chain_id,address) values($1,'LOCAL',$2,'USER',$3,'31337',$4)",
    [ids.wallet, ids.wallet, ids.researcher, address],
  );
  await c.query(
    "insert into bounties(bounty_id,program_id,policy_hash,policy_json,chain_id,escrow,reward,unallocated_reward,claimant_credit,chain_state,creation_tx) values($1,$2,$1,$3,'31337',$4,25,0,25,'QUALIFIED',$5)",
    [bounty, ids.program, JSON.stringify({ asset }), escrow, hash],
  );
  await c.query(
    "insert into uploads(id,owner_user_id,bounty_id,object_key,ciphertext_hash,key_id,byte_length,state,expires_at) values($1::uuid,$2,$3,$1::text,$4,'test',100,'COMPLETE',now()+interval '1 day')",
    [ids.upload, ids.researcher, bounty, hash],
  );
  await c.query(
    "insert into claims(claim_id,bounty_id,researcher_user_id,claimant_wallet_id,claimant_address,upload_id,evidence_commitment,job_state) values($1,$2,$3,$4,$5,$6,$7,'QUALIFIED')",
    [claim, bounty, ids.researcher, ids.wallet, address, ids.upload, hash],
  );
  await c.query(
    "insert into reports(id,claim_id,report_hash,ciphertext_object_key,wrapped_key_ref,recipient_key_id,state,delete_after) values($1,$2,$3,'test','test','test','SEALED',now()+interval '1 day')",
    [ids.report, claim, hash],
  );
  await c.query(
    "insert into chain_events(id,chain_id,contract_address,transaction_hash,log_index,block_number,block_hash,name,payload_json,finality_state) values($1,'31337',$2,$3,0,10,$4,'Paid',$5,'PENDING')",
    [
      ids.event,
      escrow,
      claim,
      hash,
      JSON.stringify({ bountyId: bounty, claimId: claim, claimant: address, asset, amount: "25" }),
    ],
  );
});
afterAll(async () => {
  if (c) {
    await c.query("rollback");
    c.release();
  }
  await pool.end();
});
describe("Report payment and current membership gates", () => {
  it("Keeps unpaid reports private from the organization", async () => {
    expect((await reportAccess(c, ids.researcher, ids.report)).state).toBe("SEALED");
    await expect(reportAccess(c, ids.owner, ids.report)).rejects.toMatchObject({
      code: "REPORT_LOCKED",
    });
    await expect(reportAccess(c, ids.other, ids.report)).rejects.toMatchObject({ status: 404 });
  });
  it("Rejects pending events and events from another contract", async () => {
    await expect(releaseReport(c, ids.report, ids.event)).rejects.toMatchObject({
      code: "PAYMENT_NOT_FINAL",
    });
    await c.query(
      "update chain_events set finality_state='FINAL',contract_address=$2 where id=$1",
      [ids.event, address],
    );
    await expect(releaseReport(c, ids.report, ids.event)).rejects.toMatchObject({
      code: "PAYMENT_NOT_FINAL",
    });
    await c.query(
      "update chain_events set contract_address=$2,payload_json=jsonb_set(payload_json,'{amount}','\"24\"') where id=$1",
      [ids.event, escrow],
    );
    await expect(releaseReport(c, ids.report, ids.event)).rejects.toMatchObject({
      code: "PAYMENT_NOT_FINAL",
    });
  });
  it("Releases once for the exact final payment", async () => {
    await c.query(
      "update chain_events set payload_json=jsonb_set(payload_json,'{amount}','\"25\"') where id=$1",
      [ids.event],
    );
    const first = await releaseReport(c, ids.report, ids.event);
    const second = await releaseReport(c, ids.report, ids.event);
    expect(first.version).toBe(second.version);
    expect(first.state).toBe("AVAILABLE");
    expect((await reportAccess(c, ids.owner, ids.report)).paid_event_ref).toBe(ids.event);
  });
  it("Stops access when finality or membership is revoked", async () => {
    await c.query("update chain_events set finality_state='ORPHANED' where id=$1", [ids.event]);
    await expect(reportAccess(c, ids.owner, ids.report)).rejects.toMatchObject({
      code: "PAYMENT_NOT_FINAL",
    });
    await c.query("update chain_events set finality_state='FINAL' where id=$1", [ids.event]);
    await c.query(
      "update memberships set status='DISABLED' where organization_id=$1 and user_id=$2",
      [ids.org, ids.owner],
    );
    await expect(reportAccess(c, ids.owner, ids.report)).rejects.toMatchObject({ status: 404 });
  });
});
