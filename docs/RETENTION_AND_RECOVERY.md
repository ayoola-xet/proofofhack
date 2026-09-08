# Retention and recovery

Status: Local retention and isolated restore checks pass. Hosted backup scheduling, backup expiry enforcement, and a hosted financial recovery drill remain incomplete.

## Data periods

| Data | Deletion clock | Access rule |
| --- | --- | --- |
| Abandoned upload | 24 hours after preparation | The upload window closes after 15 minutes. |
| Old unreferenced ciphertext or pending file | 24 hours after its file modification time | No database record permits a download. |
| Rejected, invalid, or expired claim evidence | Seven days after the terminal claim state | The verifier does not reopen a deleted upload. |
| Evidence for a paid claim | Seven days after settlement, once report release has resolved | Payment and report hashes remain. |
| Nonqualifying encrypted reports | Seven days after report creation | Only the researcher can read the report during this period. |
| A qualifying report awaiting settlement | Hold until release resolves | The organization cannot read it before final payment. |
| Paid encrypted reports | 30 days after the first successful release | The interface shows the export deadline. A release retry cannot extend it. |
| Financial receipts, report hashes, and deletion records | Retain | They contain no report body or evidence plaintext. |

An unresolved qualifying assessment keeps its reports on hold. This includes a delayed or uncertain payment. Do not clear that hold from a local status guess. The current maintenance service does not reconcile expired on-chain reservations. That recovery path remains separate work. The hold can therefore retain files longer than seven days while resolution is incomplete.

Keep organization report keys while a retained report or active bounty needs them. Deleting one report does not delete a shared organization key. Key rotation and hosted key recovery remain deployment requirements.

## Run retention

1. Apply migrations with `pnpm db:migrate`.
2. Restart the API, verifier, report service, and claim worker with the same source version.
3. Set `APP_ENV` to `local` or `arc-testnet`.
4. Set `DATABASE_URL`, `EVIDENCE_DIRECTORY`, and `REPORT_DIRECTORY` for that environment.
5. Run `pnpm retention:run` for one scan.
6. Run `pnpm dev:retention` for a scan every ten minutes.

The service requires database access and the two ciphertext directories. It does not require wallet keys, verifier signing keys, report decryption keys, Privy credentials, or Circle credentials. Give the hosted service only those permissions. The local process reads `.env`; hosted isolation must use separate environment variables and mounts.

A scan uses one exclusive database lock. Ciphertext writes use a shared lock until their metadata transaction commits. A busy scan returns `BUSY` and retries on the next interval. Never run maintenance beside an older writer version that lacks this lock.

Use separate evidence and report directories. The service resolves aliases and rejects equal or nested paths before deletion. Check that the database and directories belong to the same environment. Never point an isolated restore database at the active object directories.

Deletion first records `DELETING`. Report access then fails. The service removes both encrypted report copies and records `DELETED` after removal succeeds. A partial failure stays pending. The next scan retries the remaining objects. A deleted object restored from disk is removed again, even if its restored modification time is recent.

The service syncs directory changes after file removal. It preserves report hashes, receipt rows, and payment events. It does not promise physical erasure from storage hardware or from an unmanaged backup.

## Backup requirements

The deployment must keep encrypted database, object, and key backups. Use a seven-day maximum backup age. Delete expired backup copies and their dedicated encryption keys. This seven-day backup window can retain data after its primary-storage deletion date. Describe both dates in deployment claims.

Capture the database and object directories under the ciphertext maintenance lock. Preserve object modification times. Capture each required key version. Keep the backup encryption key outside the backup. Do not include provider account secrets in public evidence.

Automated backup creation and expiry enforcement are not implemented by the retention service. Do not claim a hosted backup or deletion guarantee until those controls and their restore test pass.

## Restore procedure

1. Restore into a new isolated database and private object directories.
2. Keep the API, verifier, transaction worker, and public report endpoints offline.
3. Check the backup age and integrity. Reject a backup beyond its configured expiry.
4. Restore the matching report key versions. Do not replace current keys with older keys in the active environment.
5. Preserve report expiry dates, payment references, report hashes, and deletion records.
6. Run a complete retention scan against the restored database and directories.
7. Confirm that expired report requests fail before any public endpoint starts.
8. Confirm that current paid reports decrypt to their saved hashes.
9. Reconcile transaction intents and receipts with canonical chain records before starting a transaction worker.
10. Enable service only after the recovery checks pass.

A retention failure or `BUSY` result does not complete a restore. Keep restored endpoints offline and retry after the cause is resolved. A database restore alone does not establish chain consistency.

## Checked recovery scope

`tests/retention.test.ts` creates an isolated PostgreSQL database and encrypted reports. It takes a real `pg_dump` backup. It restores that backup with `pg_restore` into another database. It restores object files and a report key, then runs retention.

The test proves that an expired report remains inaccessible before cleanup. It proves that cleanup removes the restored expired objects. It also proves that a current paid report still decrypts and that its hash and receipt remain. A second file restore after deletion is removed on the next scan.

This is local evidence for PRI-06. It checks the storage part of OPS-05. It does not prove hosted key custody, remote backup expiry, or reconciliation against live Arc transactions.
