import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { keccak256 } from "viem";
import { afterAll, beforeAll, expect, it } from "vitest";
import { protectCiphertextWrite } from "../packages/ciphertext-store/src/coordination.ts";
import { FileCiphertextStore } from "../packages/ciphertext-store/src/index.ts";
import {
  canonicalJson,
  createEncryptionKeyPair,
  decryptReport,
  encryptReport,
} from "../packages/crypto-envelope/src/index.ts";
import { connectDatabase, databaseUrl } from "../packages/database/src/index.ts";
import { LocalAuthProvider } from "../services/api/src/auth.ts";
import { releaseReport, reportAccess } from "../services/report-release/src/access.ts";
import { createReportDownloadApp } from "../services/report-release/src/download.ts";
import { sweepRetention } from "../services/retention/src/process.ts";
import { a, h } from "./helpers/policy.ts";

const admin = connectDatabase().pool,
  databaseName = `retention_test_${randomUUID().replaceAll("-", "")}`,
  url = new URL(databaseUrl());
url.pathname = `/${databaseName}`;
const { pool, db } = connectDatabase(url.toString()),
  directory = await mkdtemp(join(tmpdir(), "vulnproof-retention-")),
  evidenceDirectory = join(directory, "evidence"),
  reportDirectory = join(directory, "reports"),
  stores = {
    evidence: new FileCiphertextStore(evidenceDirectory, 262192),
    reports: new FileCiphertextStore(reportDirectory, 1048576),
  },
  keys = await createEncryptionKeyPair(),
  users = [0, 1, 2].map((i) => ({
    id: randomUUID(),
    token: randomUUID(),
    subject: `local:retention:${randomUUID()}`,
    displayName: `Retention actor ${i}`,
  })),
  auth = new LocalAuthProvider(users, "local"),
  download = createReportDownloadApp({
    pool,
    auth,
    mode: "organization",
    store: stores.reports,
    resolveKey: async () => keys,
  });
const ago = (days: number) => new Date(Date.now() - days * 86400000);
beforeAll(async () => {
  await admin.query(`create database ${databaseName}`);
  await migrate(db, { migrationsFolder: "packages/database/migrations" });
  for (const u of users)
    await pool.query("insert into users(id,privy_user_id,display_name) values($1,$2,$3)", [
      u.id,
      u.subject,
      u.displayName,
    ]);
});
afterAll(async () => {
  await download.close();
  await pool.end();
  await admin.query(`drop database if exists ${databaseName}`);
  await admin.end();
  await rm(directory, { recursive: true, force: true });
});
async function fixture(
  mode: "ABANDONED" | "REJECTED" | "HELD" | "PAID" | "PAID_EXPIRED",
  daysOld = 8,
) {
  const ids = {
      org: randomUUID(),
      program: randomUUID(),
      wallet: randomUUID(),
      upload: randomUUID(),
      report: randomUUID(),
      event: randomUUID(),
      orgObject: randomUUID(),
      researcherObject: randomUUID(),
    },
    bounty = keccak256(new TextEncoder().encode(ids.org)),
    claim = keccak256(new TextEncoder().encode(ids.upload)),
    body = new TextEncoder().encode(
      canonicalJson({
        claimId: claim,
        bountyId: bounty,
        policyHash: bounty,
        evidenceScope: "FIXTURE_ONLY",
        verifierMode: "TRUSTED_SERVICE",
        privateMarker: randomUUID(),
      }),
    ),
    reportHash = keccak256(body),
    evidenceBytes = new Uint8Array([1, 2, 3, 4, 5]),
    paid = ["PAID", "PAID_EXPIRED"].includes(mode),
    hold = mode === "HELD",
    deadline = mode === "PAID" ? ago(-29) : ago(1);
  await pool.query(
    "insert into organizations(id,onchain_id,name,owner_user_id) values($1,$2,'Retention fixture',$3)",
    [ids.org, bounty, users[0].id],
  );
  await pool.query("insert into memberships(organization_id,user_id,role) values($1,$2,'OWNER')", [
    ids.org,
    users[0].id,
  ]);
  await pool.query(
    "insert into programs(id,organization_id,name) values($1,$2,'Retention fixture')",
    [ids.program, ids.org],
  );
  await pool.query(
    "insert into wallets(id,provider,provider_wallet_id,owner_type,owner_id,chain_id,address) values($1::uuid,'LOCAL',$1::text,'USER',$2,'31337',$3)",
    [ids.wallet, users[1].id, a(4)],
  );
  await pool.query(
    "insert into bounties(bounty_id,program_id,policy_hash,policy_json,chain_id,escrow,reward,unallocated_reward,claimant_credit,chain_state,creation_tx) values($1,$2,$1,$3,'31337',$4,25,0,0,$5,$6)",
    [
      bounty,
      ids.program,
      JSON.stringify({ asset: a(5), reportRecipientKeyId: h(6) }),
      a(6),
      paid ? "PAID" : "FUNDED",
      h(7),
    ],
  );
  await pool.query(
    "insert into uploads(id,owner_user_id,bounty_id,object_key,ciphertext_hash,key_id,byte_length,state,expires_at,delete_after,created_at) values($1::uuid,$2,$3,$1::text,$4,'test',5,$5,$6,$7,$8)",
    [
      ids.upload,
      users[1].id,
      bounty,
      keccak256(evidenceBytes),
      mode === "ABANDONED" ? "UPLOADING" : "UPLOADED",
      ago(-1),
      mode === "ABANDONED" ? ago(daysOld - 1) : null,
      ago(daysOld),
    ],
  );
  await pool.query(
    "insert into claims(claim_id,bounty_id,researcher_user_id,claimant_wallet_id,claimant_address,upload_id,evidence_commitment,job_state,updated_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [
      claim,
      bounty,
      users[1].id,
      ids.wallet,
      a(4),
      ids.upload,
      keccak256(evidenceBytes),
      mode === "ABANDONED" ? "UPLOADING" : hold ? "SETTLEMENT_PENDING" : "SETTLED",
      ago(daysOld),
    ],
  );
  await stores.evidence.put(ids.upload, evidenceBytes, keccak256(evidenceBytes));
  let orgBytes: Uint8Array | undefined, researcherBytes: Uint8Array | undefined;
  if (mode !== "ABANDONED") {
    await pool.query(
      "insert into chain_events(id,chain_id,contract_address,transaction_hash,log_index,block_number,block_hash,name,payload_json,finality_state) values($1,'31337',$2,$3,0,10,$4,'Paid',$5,'FINAL')",
      [
        ids.event,
        a(6),
        claim,
        h(9),
        JSON.stringify({
          bountyId: bounty,
          claimId: claim,
          claimant: a(4),
          asset: a(5),
          amount: "25",
        }),
      ],
    );
    orgBytes = new TextEncoder().encode(canonicalJson(await encryptReport(body, keys.publicKey)));
    researcherBytes = new TextEncoder().encode(
      canonicalJson(await encryptReport(body, keys.publicKey)),
    );
    await stores.reports.put(ids.orgObject, orgBytes, keccak256(orgBytes));
    await stores.reports.put(ids.researcherObject, researcherBytes, keccak256(researcherBytes));
    await pool.query(
      "insert into reports(id,claim_id,report_hash,ciphertext_object_key,ciphertext_hash,researcher_object_key,researcher_ciphertext_hash,researcher_key_id,wrapped_key_ref,recipient_key_id,state,paid_event_ref,available_at,delete_after,retention_hold) values($1,$2,$3,$4,$5,$6,$7,$8,'test',$8,$9,$10,$11,$12,$13)",
      [
        ids.report,
        claim,
        reportHash,
        ids.orgObject,
        keccak256(orgBytes),
        ids.researcherObject,
        keccak256(researcherBytes),
        h(6),
        paid ? "AVAILABLE" : "SEALED",
        paid ? ids.event : null,
        paid ? ago(mode === "PAID" ? 1 : 31) : null,
        deadline,
        hold,
      ],
    );
    if (paid)
      await pool.query(
        "insert into receipts(organization_id,bounty_id,category,amount,asset,event_id,status) values($1,$2,'PAYMENT',25,$3,$4,'FINAL')",
        [ids.org, bounty, a(5), ids.event],
      );
  }
  return { ...ids, bounty, claim, body, reportHash, evidenceBytes, orgBytes, researcherBytes };
}
it("deletes abandoned and terminal evidence but preserves active settlement and current paid reports", async () => {
  const abandoned = await fixture("ABANDONED", 2),
    recent = await fixture("ABANDONED", 0),
    rejected = await fixture("REJECTED"),
    held = await fixture("HELD"),
    paid = await fixture("PAID", 2);
  await sweepRetention(pool, stores);
  for (const f of [abandoned, rejected])
    await expect(stores.evidence.read(f.upload, keccak256(f.evidenceBytes))).rejects.toMatchObject({
      code: "ENOENT",
    });
  for (const f of [recent, held, paid])
    expect(await stores.evidence.read(f.upload, keccak256(f.evidenceBytes))).toEqual(
      f.evidenceBytes,
    );
  expect(
    (await pool.query("select job_state from claims where claim_id=$1", [abandoned.claim])).rows[0]
      .job_state,
  ).toBe("EXPIRED");
  expect((await reportAccess(pool, users[1].id, held.report, "researcher")).retention_hold).toBe(
    true,
  );
  expect((await reportAccess(pool, users[0].id, paid.report, "organization")).state).toBe(
    "AVAILABLE",
  );
  expect(
    (await pool.query("select count(*) from receipts where organization_id=$1", [paid.org])).rows[0]
      .count,
  ).toBe("1");
});
it("starts a stable 30-day clock at first release and does not extend it on retry", async () => {
  const f = await fixture("HELD"),
    c = await pool.connect();
  try {
    await c.query("begin");
    const first = await releaseReport(c, f.report, f.event),
      second = await releaseReport(c, f.report, f.event);
    expect(first.retention_hold).toBe(false);
    expect(first.delete_after.getTime() - first.available_at.getTime()).toBe(30 * 86400000);
    expect(second.delete_after).toEqual(first.delete_after);
    expect(second.version).toBe(first.version);
    await c.query("commit");
  } finally {
    c.release();
  }
  await sweepRetention(pool, stores);
  expect((await reportAccess(pool, users[0].id, f.report, "organization")).state).toBe("AVAILABLE");
});
it("does not disclose an expired report to another user and rejects downloaded expired data", async () => {
  const f = await fixture("PAID_EXPIRED");
  for (const [actor, status] of [
    [0, 410],
    [2, 404],
  ] as const) {
    const response = await download.inject({
      url: `/private/organization/reports/${f.report}`,
      headers: { authorization: `Bearer ${users[actor].token}` },
    });
    expect(response.statusCode).toBe(status);
    expect(response.body).not.toContain(new TextDecoder().decode(f.body));
  }
});
it("keeps deletion pending after partial failure and retries without reviving the report", async () => {
  const f = await fixture("PAID_EXPIRED");
  let fail = true;
  class FailingStore extends FileCiphertextStore {
    override async remove(id: string) {
      if (fail && id === f.researcherObject) {
        fail = false;
        throw new Error("Storage unavailable");
      }
      await super.remove(id);
    }
  }
  await expect(
    sweepRetention(pool, { ...stores, reports: new FailingStore(reportDirectory, 1048576) }),
  ).rejects.toThrow("Storage unavailable");
  expect(
    (await pool.query("select state,deleted_at from reports where id=$1", [f.report])).rows[0],
  ).toEqual({ state: "DELETING", deleted_at: null });
  await expect(reportAccess(pool, users[0].id, f.report, "organization")).rejects.toMatchObject({
    status: 410,
  });
  await sweepRetention(pool, stores);
  const deleted = (await pool.query("select deleted_at from reports where id=$1", [f.report]))
    .rows[0].deleted_at;
  await sweepRetention(pool, stores);
  expect(
    (await pool.query("select deleted_at from reports where id=$1", [f.report])).rows[0].deleted_at,
  ).toEqual(deleted);
  await expect(
    pool.query("update reports set state='AVAILABLE' where id=$1", [f.report]),
  ).rejects.toMatchObject({ code: "23514" });
});
it("coordinates cleanup with writes and removes only old unreferenced objects", async () => {
  const oldId = randomUUID(),
    youngId = randomUUID(),
    pendingId = randomUUID(),
    data = new Uint8Array([8]);
  await stores.reports.put(oldId, data, keccak256(data));
  await stores.reports.put(youngId, data, keccak256(data));
  await writeFile(join(reportDirectory, `${pendingId}.pending`), data);
  for (const file of [`${oldId}.sealed`, `${pendingId}.pending`])
    await utimes(join(reportDirectory, file), ago(2), ago(2));
  await writeFile(join(reportDirectory, "keep-this-file.txt"), "Unrelated file");
  const c = await pool.connect();
  try {
    await c.query("begin");
    await protectCiphertextWrite(c);
    expect((await sweepRetention(pool, stores)).state).toBe("BUSY");
    expect(await stores.reports.read(oldId, keccak256(data))).toEqual(data);
    await c.query("rollback");
  } finally {
    c.release();
  }
  await sweepRetention(pool, stores);
  await expect(stores.reports.read(oldId, keccak256(data))).rejects.toMatchObject({
    code: "ENOENT",
  });
  await expect(readFile(join(reportDirectory, `${pendingId}.pending`))).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(await stores.reports.read(youngId, keccak256(data))).toEqual(data);
  expect(await readFile(join(reportDirectory, "keep-this-file.txt"), "utf8")).toBe(
    "Unrelated file",
  );
});

async function postgresTool(args: string[], input?: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn("docker", ["exec", "-i", "vulnproof-postgres-1", ...args], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const output: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => output.push(chunk));
    child.stderr.resume();
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(Buffer.concat(output))
        : reject(new Error("The isolated PostgreSQL backup or restore failed.")),
    );
    child.stdin.end(input);
  });
}
it("rejects storage aliases before deleting an object", async () => {
  const f = await fixture("PAID_EXPIRED"),
    alias = join(directory, "report-alias");
  await symlink(reportDirectory, alias);
  await expect(
    sweepRetention(pool, {
      evidence: new FileCiphertextStore(alias, 262192),
      reports: stores.reports,
    }),
  ).rejects.toThrow("separate directories");
  expect(
    (await pool.query("select state from reports where id=$1", [f.report])).rows[0].state,
  ).toBe("AVAILABLE");
});
it("PRI-06 restores a real database, encrypted objects, and keys, then removes expired data before access", async () => {
  const expired = await fixture("PAID_EXPIRED"),
    kept = await fixture("PAID", 2),
    backupDirectory = join(directory, "backup"),
    restoredDirectory = join(directory, "restored"),
    restoredName = `retention_restore_${randomUUID().replaceAll("-", "")}`;
  if (!expired.orgBytes || !kept.orgBytes)
    throw new Error("The restore fixture requires encrypted reports.");
  await mkdir(backupDirectory, { mode: 0o700 });
  await cp(reportDirectory, join(backupDirectory, "reports"), {
    recursive: true,
    preserveTimestamps: true,
  });
  await cp(evidenceDirectory, join(backupDirectory, "evidence"), {
    recursive: true,
    preserveTimestamps: true,
  });
  await writeFile(join(backupDirectory, "keys.json"), JSON.stringify(keys), { mode: 0o600 });
  const dump = await postgresTool([
    "pg_dump",
    "-U",
    "vulnproof",
    "-d",
    databaseName,
    "--format=custom",
    "--no-owner",
    "--no-acl",
  ]);
  await sweepRetention(pool, stores);
  await admin.query(`create database ${restoredName}`);
  const restoredUrl = new URL(url);
  restoredUrl.pathname = `/${restoredName}`;
  const restored = connectDatabase(restoredUrl.toString()).pool;
  try {
    await postgresTool(
      [
        "pg_restore",
        "-U",
        "vulnproof",
        "-d",
        restoredName,
        "--no-owner",
        "--no-acl",
        "--exit-on-error",
      ],
      dump,
    );
    await cp(backupDirectory, restoredDirectory, { recursive: true, preserveTimestamps: true });
    const recovered = {
      evidence: new FileCiphertextStore(join(restoredDirectory, "evidence"), 262192),
      reports: new FileCiphertextStore(join(restoredDirectory, "reports"), 1048576),
    };
    expect(
      (await restored.query("select deleted_at from reports where id=$1", [expired.report])).rows[0]
        .deleted_at,
    ).toBeNull();
    await expect(
      reportAccess(restored, users[0].id, expired.report, "organization"),
    ).rejects.toMatchObject({ status: 410 });
    await sweepRetention(restored, recovered);
    await expect(
      recovered.reports.read(expired.orgObject, keccak256(expired.orgBytes)),
    ).rejects.toMatchObject({ code: "ENOENT" });
    const restoredKey = JSON.parse(await readFile(join(restoredDirectory, "keys.json"), "utf8")),
      envelope = JSON.parse(
        new TextDecoder().decode(
          await recovered.reports.read(kept.orgObject, keccak256(kept.orgBytes)),
        ),
      );
    expect(await decryptReport(envelope, restoredKey)).toEqual(kept.body);
    expect(
      (await reportAccess(restored, users[0].id, kept.report, "organization")).report_hash,
    ).toBe(kept.reportHash);
    expect(
      (await restored.query("select count(*) from receipts where organization_id=$1", [kept.org]))
        .rows[0].count,
    ).toBe("1");
    await recovered.reports.put(expired.orgObject, expired.orgBytes, keccak256(expired.orgBytes));
    await sweepRetention(restored, recovered);
    await expect(
      recovered.reports.read(expired.orgObject, keccak256(expired.orgBytes)),
    ).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await restored.end();
    await admin.query(`drop database if exists ${restoredName}`);
  }
}, 30000);
