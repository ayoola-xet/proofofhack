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
| A qualifying report awaiting settlement | Hold until release or final reservation expiry resolves | The organization cannot read it before final payment. |
| A held report after confirmed reservation expiry | Seven days after the first expiry reconciliation | Only the researcher can read it during this period. |
| Paid encrypted reports | 30 days after the first successful release | The interface shows the export deadline. A release retry cannot extend it. |
| Financial receipts, report hashes, and deletion records | Retain | They contain no report body or evidence plaintext. |

An unresolved qualifying assessment keeps its reports on hold. This includes a delayed or uncertain payment. Do not clear that hold from a local status guess. The recovery receipt route can resolve a matching final `ReservationExpired` event. The automatic worker scans final expiry and refund events. It submits an eligible recovery after it catches up with the chain. The hold can therefore retain files longer than seven days while resolution is incomplete.

## Reconcile an executed expiry or refund

1. Obtain the hash of the executed `expireReservation` or `refundExpired` transaction.
2. Sign in as a current owner or treasury member of the bounty organization.
3. Send `POST /api/v1/bounties/:id/recovery-receipts` with `transactionHash` and an `Idempotency-Key` header.
4. Retry `RECOVERY_NOT_FINAL` or `RECOVERY_BUSY` after the chain or active claim process has progressed. Keep the same request input.
5. Check the returned final event IDs. For a refund, check the organization receipt list.

The route uses the configured chain and escrow. It verifies the saved policy, canonical final receipt, and final bounty state. A refund must contain the exact token transfer to the immutable refund recipient. The request cannot supply an RPC address, transfer amount, or recipient. The route records an executed transaction. It does not sign or send one.

An expiry changes only its matching local claim to `EXPIRED`. It clears that report's hold after any active assessment finishes. The report remains sealed to the organization. The first reconciliation gives a held report seven days for researcher export. A retry cannot extend that date. The `expiry_event_ref` field preserves the final expiry evidence. A database trigger rejects a different claim's event or a change to established expiry terms.

A refund creates one `REFUND` receipt and records a zero remaining balance. A refund transaction can also contain the reservation expiry. An older expiry can resolve its claim without replacing a newer refund state. A refund alone cannot release a report hold when the separate expiry receipt is missing.

The API, worker, and recovery screen implement the FR-16 path. Local desktop, mobile, keyboard, and receipt-input checks pass with synthetic API responses. Live Arc recovery evidence and the signed-in account journey remain required before release.

Keep organization report keys while a retained report or active bounty needs them. Deleting one report does not delete a shared organization key. Key rotation and hosted key recovery remain deployment requirements.

## Automatic recovery

Start `pnpm dev:worker` with the configured Circle agent wallet, Arc escrow, and database. The worker checks known bounties each minute. It scans at most five pages of 2000 blocks per check. It starts at the verified funding receipt and saves each completed page with its block hash. A restart resumes the next block.

The worker records expiry and refund events sent by other callers. It checks final receipts before changing claim status, report holds, or financial receipts. It stops if a saved final checkpoint changes. This scanner covers recovery events. It does not replace the payment and funding reconciliation paths.

After the scanner catches up, the worker closes an elapsed reservation. After the settlement deadline, it requests a refund of unallocated reward. The refund destination and amount come from the immutable contract policy. Qualified claimant credit remains payable and has no recovery deadline.

The worker saves the exact request before it calls Circle. It uses one provider key for an unresolved request. It preserves a known transaction hash and waits for finality. A matching final event can resolve a lost response without another send. A request with an unknown hash stops for review after 23 hours. A final reverted transaction can permit a new attempt. Five failed transaction attempts stop automatic sends for that action.

The claim worker stops assessment retries when its final chain read shows an expired reservation. It queues recovery and records `RECOVERY_PENDING`. It preserves the report hold until the matching expiry event is final.

Owners and treasury members can open **Expiry and refunds** on the bounty page. Use **Check recovery now** to queue a check. A retry preserves the active request and scan checkpoint. It cannot bypass an unresolved transaction or a changed final checkpoint. Use **Record final receipt** when a recovery transaction was completed outside the worker.

`COMPLETE` means that the recovery scan has reached a final qualified, paid, or refunded bounty state. It does not mean that a qualified claimant has already collected payment. Check the chain state and financial receipt separately.

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

## Live testnet refund evidence

The worker automatically refunds a 0.25-test-USDC bounty after its fixed cutoff. [The evidence record](../evidence/arc/recovery-0xa26a9f3f8c56461e41ed35f85af089ef63617692a1e284abe60ad1953c813b87.json) checks final funding and refund receipts, the exact recipient and amount, the Circle smart-account operation, and the completed queue job. One saved refund intent and one receipt remain.

The test has no claim or reservation. Live reservation-expiry evidence and hosted restore evidence remain incomplete. Earlier retries complete without a duplicate refund. Their original cause is not recorded. Current recovery diagnostics identify the failed stage and omit private provider error text.
