# Data and API specification

Version: 1.0.0

## 1. Common rules

Use PostgreSQL UUIDs for application entities. Use 32-byte hex strings for onchain IDs and hashes. `organizationIdOnchain = keccak256(UTF8("VulnProof:organization:v1:" + lowercaseUuid))`. Keep the UUID and hash in the same organization record.

Use lowercase EVM addresses in storage and checksummed addresses for display. Qualify every address with its chain ID. Validate addresses with the chain library. Store token amounts as `numeric(78,0)` and serialize them as decimal strings. Store chain timestamps as integer seconds in signed payloads. Use ISO 8601 UTC timestamps in API metadata.

Use Zod or an equivalent schema library in `packages/domain`. Generate OpenAPI 3.1 from the implemented schemas. Commit the generated API contract. The build must fail if code and generated API schemas diverge.

Reject unknown fields on financial, evidence, authorization, and assessment inputs. Set explicit length and count limits. Use cursor pagination with a default of 25 and a maximum of 100.

## 2. Database model

All mutable records include `created_at`, `updated_at`, and an optimistic concurrency `version`. Chain projections also include their last applied event key. Avoid hard deletion of financial records.

| Table | Main fields | Required constraints |
| --- | --- | --- |
| `users` | id, privy_user_id, display_name | Unique privy_user_id |
| `organizations` | id, onchain_id, name, owner_user_id, status | Unique onchain_id |
| `memberships` | organization_id, user_id, role, status | Unique organization_id + user_id |
| `wallets` | id, provider, provider_wallet_id, owner_type, owner_id, chain_id, address, policy_ref | Unique provider wallet ID; unique owner role binding |
| `programs` | id, organization_id, name, coverage_policy_id, status | Organization-scoped name uniqueness |
| `registered_vaults` | id, organization_id, source_chain_id, address, asset, decimals, label, fixture_scope | Unique organization + chain + address |
| `vault_observations` | id, vault_id, provider_deployment_id, schema_version, observed_block, observed_hash, indexed_head, observed_at, fetched_at, metrics_json, read_status | Unique deployment + vault + observed block |
| `coverage_policies` | id, organization_id, version_number, min_reward, max_data_age_seconds, allowed_vault_ids, approved_by | Immutable approved versions |
| `coverage_records` | id, vault_id, policy_id, source_observation_id, funded_reward, status, reason, computed_at | Unique vault + policy + observation |
| `recommendations` | id, organization_id, source_ids, policy_id, calculation_json, explanation, action_json, expires_at, status | Source IDs required for non-abstaining answers |
| `fixture_manifests` | id, root, version_number, owner_signature, source_context_json, synthetic, registered_by | Unique root; synthetic must be true in version 1 |
| `bounty_drafts` | id, program_id, policy_json, policy_hash, created_by, approved_by, status | Approved content is immutable |
| `bounties` | bounty_id, program_id, policy_hash, policy_json, chain_id, escrow, reward, unallocated_reward, claimant_credit, chain_state, creation_tx | Unique bounty_id; amounts nonnegative |
| `uploads` | id, owner_user_id, bounty_id, object_key, ciphertext_hash, key_id, byte_length, state, expires_at | Opaque object key; owner check on every access |
| `claims` | claim_id, bounty_id, researcher_user_id, claimant_wallet_id, claimant_address, upload_id, evidence_commitment, case_nullifier, job_state, reservation_expiry | Unique upload_id per final submission |
| `admissions` | id, claim_id, nonce, payload_json, signature_ref, valid_until, state | Unique nonce |
| `assessments` | id, claim_id, outcome, report_hash, payload_json, signature_ref, assessed_at | Unique final assessment per reservation |
| `reports` | id, claim_id, report_hash, ciphertext_object_key, wrapped_key_ref, recipient_key_id, state, paid_event_ref, available_at, delete_after | Unique claim_id; paid_event_ref required for organization availability |
| `budget_controllers` | id, organization_id, address, owner_wallet_id, operator_wallet_id, asset, enabled, limit_projection_json | Unique organization + chain + deployment |
| `approved_allocations` | id, controller_id, policy_hash, reward, expires_at, consumed_event_ref | Unique controller + policy_hash |
| `agent_actions` | id, controller_id, recommendation_id, policy_hash, idempotency_key, provider_request_id, tx_intent_id, state, rejection_code | Unique idempotency_key |
| `transaction_intents` | id, chain_id, provider, wallet_id, purpose, request_hash, provider_request_id, sender_nonce, transaction_hash, state | Unique wallet + idempotency scope |
| `chain_events` | id, chain_id, transaction_hash, log_index, block_number, block_hash, name, payload_json, finality_state | Unique chain + transaction hash + log index |
| `receipts` | id, organization_id, claimant_user_id, bounty_id, category, amount, asset, event_id, status | Unique event_id + category |
| `outbox` | id, event_type, aggregate_id, payload_json, processed_at | Stable deduplication key |
| `audit_events` | id, actor_id, organization_id, action, resource_id, result_code, request_id | Append only; no confidential payload |
| `idempotency_records` | actor_id, route, key, request_hash, response_ref, expires_at | Unique actor + route + key |

Use foreign keys for ownership relations. Index organization IDs, owner user IDs, bounty IDs, job states, transaction hashes, report state, and expiry times. Add a partial unique index to stop the application from treating two claims as active reservations for one bounty. The chain remains the final authority if a projection is behind.

## 3. Graph schema contract

Implement these standardized entity shapes. Use Graph-compatible scalar types. The following is a domain schema, not a claim that these entities already exist at a provider.

```graphql
type Vault @entity(immutable: false) {
  id: ID!
  chainId: BigInt!
  address: Bytes!
  asset: Bytes
  assetDecimals: Int
  shareDecimals: Int
  implementationLabel: String
  firstObservedBlock: BigInt!
  latestObservation: VaultObservation
}

type VaultObservation @entity(immutable: true) {
  id: ID!
  vault: Vault!
  blockNumber: BigInt!
  blockHash: Bytes!
  blockTimestamp: BigInt!
  totalAssets: BigInt
  totalSupply: BigInt
  readStatus: String!
  schemaVersion: String!
}

type VaultFlow @entity(immutable: true) {
  id: ID!
  vault: Vault!
  kind: String!
  sender: Bytes!
  owner: Bytes!
  receiver: Bytes
  assets: BigInt!
  shares: BigInt!
  transactionHash: Bytes!
  logIndex: BigInt!
  blockNumber: BigInt!
}

type SourceCursor @entity(immutable: false) {
  id: ID!
  chainId: BigInt!
  blockNumber: BigInt!
  blockHash: Bytes!
  blockTimestamp: BigInt!
}
```

Use `chainId:address` for vault IDs. Use `vaultId:blockNumber` for observations. Use `chainId:transactionHash:logIndex` for flows. Define event kind as `DEPOSIT` or `WITHDRAWAL`. Record null for unavailable optional metrics. Do not convert a failed read into zero.

Provide one query client that accepts a network/deployment configuration plus vault IDs. Normalize provider results to `VaultObservationDTO`. Demonstrate the same query shape against the required deployments. Persist `_meta` index-head metadata when supplied by the provider.

## 4. Shared objects

### 4.1 Money

```json
{
  "chainId": "5042002",
  "asset": "0x3600000000000000000000000000000000000000",
  "amountBaseUnits": "25000000",
  "decimals": 6,
  "symbol": "USDC"
}
```

This example means 25 USDC. It is illustrative test data.

### 4.2 Policy

`BountyPolicyDTO` contains every field from `BountyPolicyV1` in the technical specification. Represent integers as decimal strings. Represent addresses as validated hex strings. Add offchain `schemaVersion`, `evidenceScope`, and `verifierMode`. Those fields must match the adapter and verifier configuration committed by the policy.

Use `schemaVersion: "1"`, `evidenceScope: "FIXTURE_ONLY"`, and `verifierMode: "TRUSTED_SERVICE"` in this release. Do not accept client-defined variants.

### 4.3 Evidence envelope

```text
version: "1"
algorithm: "libsodium-sealed-box"
keyId: approved verifier encryption key ID
uploadId: UUID
ciphertextHash: 32-byte hash
ciphertextBytes: integer within the configured bound
```

`evidenceCommitment` is the ciphertext hash for this submitted envelope. It binds the reservation to uploaded bytes. The fixture leaf commitment separately authenticates the plaintext record. These are different values with different purposes.

### 4.4 Private fixture record

```text
schemaVersion: "1"
manifestVersion: "1"
caseId: bytes32
expectedAssets: unsigned integer string
observedAssets: unsigned integer string
salt: bytes32
merkleProof: bytes32 array, maximum 32 entries
```

Accept no external URLs, free-form code, or transaction instructions. Client validation is a convenience. The verifier repeats all validation after decryption.

### 4.5 Canonical report

```text
schemaVersion: "1"
claimId: bytes32
bountyId: bytes32
policyHash: bytes32
evidenceScope: "FIXTURE_ONLY"
verifierMode: "TRUSTED_SERVICE"
caseId: bytes32
fixtureLeafHash: bytes32
sourceContext: {chainId, vault, blockHash}
expectedAssets: integer string
observedAssets: integer string
discrepancy: integer string
minimumDiscrepancy: integer string
outcome: "QUALIFIES" | "DOES_NOT_QUALIFY"
explanationCode: fixed enum
limitation: fixed statement that this is synthetic evidence
assessedAt: integer seconds string
```

Render human text from `explanationCode`. Keep the canonical report independent of CSS, locale, and PDF rendering. Version 1 reports can be downloaded as JSON and printed from the authenticated browser view.

### 4.6 Recommendation

```text
id, organizationId, coveragePolicyVersion
status: ACTIONABLE | NO_ACTION | ABSTAIN
sourceIds: nonempty for actionable output
sourceTimes: ISO timestamps
calculation: deterministic structured result
explanation: plain text with source references
proposedAction: {kind: FUND_APPROVED_POLICY, controllerId, policyHash} | null
expiresAt
reasonCode
```

Use `ABSTAIN` for stale data, missing asset metadata, unsupported units, or unavailable approved policy. A model error does not justify inventing a recommendation. The deterministic table remains usable when the model is unavailable.

## 5. API conventions

Base path: `/api/v1`. Require verified authentication except for the minimal public health response. All resource identifiers are opaque. Public onchain facts do not make private API resources public.

Mutation endpoints require `Idempotency-Key`. Store its request hash for at least 24 hours. An identical retry returns the same resource or intent. Reusing a key with a different body returns `409 IDEMPOTENCY_CONFLICT`. Onchain uniqueness and provider reconciliation remain necessary after this storage window.

For financial requests, support `If-Match` with the resource version when appropriate. An outdated version returns `409 STALE_RESOURCE`. Reject unexpected content types.

Return errors as:

```json
{
  "error": {
    "code": "RESERVATION_BUSY",
    "message": "Another claim has reserved this bounty.",
    "requestId": "opaque-request-id",
    "retryable": true
  }
}
```

Do not include stack traces, private report paths, signatures, or upstream secrets in error responses.

## 6. Public application endpoints

| Method and route | Authorized caller | Request | Success response |
| --- | --- | --- | --- |
| `GET /health` | Anyone | None | 200 minimal availability and environment label |
| `GET /me` | User | None | 200 user, memberships, own wallet summaries |
| `POST /organizations` | User | name | 201 organization; caller becomes owner |
| `GET /organizations/:id` | Member | None | 200 organization and permitted settings |
| `POST /organizations/:id/members` | Owner | verified user reference, role | 201 membership; no external invitation message |
| `PATCH /organizations/:id/members/:userId` | Owner | role or disabled status | 200 updated membership |
| `POST /organizations/:id/wallets` | Owner | documented provider wallet setup parameters | 202 setup resource; never return private keys |
| `GET /organizations/:id/wallets` | Owner or treasury | None | 200 owned wallet metadata and live balance state |
| `POST /organizations/:id/wallet-policy` | Owner | approved policy template and values | 202 provider operation reference |
| `POST /organizations/:id/programs` | Owner or reviewer | name, approved coverage policy reference | 201 program |
| `GET /organizations/:id/programs` | Member | pagination | 200 program page |
| `POST /organizations/:id/vaults` | Owner or reviewer | configured chain and allowlisted source vault reference | 201 registration |
| `GET /organizations/:id/coverage` | Member | cursor and status filter | 200 records with source metadata |
| `POST /organizations/:id/coverage/questions` | Member | question up to 2000 characters | 202 answer job; stream or poll by ID |
| `GET /recommendations/:id` | Member of owning organization | None | 200 recommendation |
| `POST /programs/:id/bounty-drafts` | Owner or reviewer | fixed policy inputs and known fixture manifest | 201 draft and canonical policy hash |
| `POST /bounty-drafts/:id/approve` | Owner | expected policy hash | 200 immutable approved draft |
| `POST /bounty-drafts/:id/funding-intents` | Owner or treasury | owned funding wallet ID | 202 transaction intent for exact approved policy |
| `GET /bounties/:id` | Member or authenticated researcher viewing open fixture bounty | None | 200 public terms and confirmed chain state; no private claim contents |
| `GET /bounties` | User | network, availability, pagination | 200 visible fixture bounty page |
| `POST /bounties/:id/uploads` | Researcher | envelope metadata and claimant wallet ID | 201 upload ID and short-lived upload destination |
| `POST /uploads/:id/complete` | Upload owner | ciphertext hash and bytes | 202 server verification of object metadata |
| `POST /bounties/:id/claims` | Upload owner | completed upload ID and claimant wallet ID | 202 claim and admission status |
| `GET /claims/:id` | Claim owner; organization sees redacted status only | None | 200 role-filtered claim status |
| `POST /claims/:id/payment-intents` | Claim owner | None | 202 collection intent to the fixed beneficiary |
| `GET /claims/:id/report` | Claim owner | None | 200 authenticated verifier stream or 409 report-not-ready |
| `GET /reports/:id` | Owner or reviewer of paid report’s organization | None | 200 report stream only after final payment |
| `POST /organizations/:id/budget-controllers` | Owner | wallet IDs, limits, approved chain | 202 deployment intent |
| `POST /budget-controllers/:id/approved-policies` | Owner | policy hash, reward, expiry | 202 approval transaction intent |
| `POST /budget-controllers/:id/funding-intents` | Owner or treasury | amount and organization wallet ID | 202 controlled transfer intent |
| `PATCH /budget-controllers/:id/settings` | Owner | enabled, future limits, expected version | 202 owner transaction intent |
| `POST /budget-controllers/:id/actions` | Owner-triggered run or internal scheduler | recommendation ID | 202 approved action or 409 policy rejection |
| `GET /budget-controllers/:id/actions` | Owner or treasury | pagination | 200 action history |
| `GET /organizations/:id/receipts` | Owner or treasury | filters and cursor | 200 final and pending receipts with separate status |
| `POST /organizations/:id/receipt-exports` | Owner or treasury | filters | 202 export job |
| `GET /exports/:id` | Export owner with current membership | None | 200 authenticated CSV download |
| `GET /wallets/me` | Researcher | None | 200 own wallets and balances |
| `POST /wallets/me/transfer-intents` | Wallet owner | wallet ID, recipient, amount, network | 202 Privy transfer intent requiring user authorization |
| `GET /transaction-intents/:id` | Intent owner or permitted treasury member | None | 200 observed intent state |
| `GET /jobs/:id` | Job owner or permitted organization member | None | 200 sanitized progress and recovery action |

Member management uses an existing verified user reference in version 1. Do not add outbound email just to support invitations. Prevent removal of the last owner. Revocation must invalidate report access without waiting for a browser session refresh.

An API response that prepares a wallet action must expose the exact destination, chain, asset, and amount for user review. The browser must use the supported Privy confirmation flow. It cannot substitute arbitrary transaction fields after approval.

## 7. Internal service endpoints

| Endpoint | Caller | Contract |
| --- | --- | --- |
| `POST /internal/admissions` | API worker | Claim ID and upload ID only; return a scoped admission result |
| `POST /internal/verifications` | Job worker | Final reservation reference; return durable job ID |
| `GET /internal/verifications/:id` | Job worker | Sanitized result, report hash, and assessment reference |
| `POST /internal/report-release` | Reconciler | Final payment event ID and report ID; repeat safely |
| `POST /internal/coverage-refresh` | Scheduler | Organization ID and configured provider references |
| `POST /internal/agent-run` | Scheduler | Controller ID and approved recommendation ID |

Require service identity, a short token expiry, and the correct audience. Never accept user-specified storage URLs, RPC URLs, shell commands, or model instructions on these routes.

## 8. Contract events

Implement these event names. Include indexed IDs where useful. Event payloads contain public commitments only.

```text
BountyFunded(bountyId, organizationId, reward, asset, policyHash)
ClaimReserved(bountyId, claimId, claimant, evidenceCommitment, expiresAt)
ClaimRejected(bountyId, claimId)
ReservationExpired(bountyId, claimId)
ClaimQualified(bountyId, claimId, claimant, reward, reportHash)
Paid(bountyId, claimId, claimant, asset, amount)
BountyRefunded(bountyId, refundRecipient, asset, amount)
PolicyApproved(controller, policyHash, reward, expiresAt)
BudgetAllocated(controller, policyHash, bountyId, amount, utcDayBucket)
BudgetSettingsChanged(controller, enabled, perActionLimit, dailyLimit, minimumInterval)
BudgetWithdrawn(controller, recipient, amount)
```

Do not emit private fixture values, salts, report text, encryption keys, or recoverable evidence fragments. A paid event may reveal that the target has a qualifying fixture claim. Explain public metadata in the trust notice.

## 9. Provider adapters

Expose narrow interfaces. Keep provider SDK calls behind these interfaces so tests can substitute labelled local doubles.

```text
AuthProvider.verifySession(token)
UserWalletProvider.listOwnedWallets(user)
UserWalletProvider.prepareTransaction(owner, approvedIntent)
UserWalletProvider.getRequestStatus(providerRequestId)
UserWalletProvider.applyPolicy(owner, approvedPolicy)
OperationsWalletProvider.executeApprovedContractCall(action)
GraphProvider.queryCoverageSource(deploymentId, validatedQueryInput)
ModelProvider.explainCoverage(validatedFacts, deterministicResult)
CiphertextStore.createUpload(owner, boundedMetadata)
CiphertextStore.readInternalObject(objectId)
SecretStore.unwrapForService(serviceIdentity, wrappedKeyRef)
FinalityProvider.observeTransaction(chainId, transactionHash)
```

The operations adapter accepts a domain action, not arbitrary calldata. It encodes only `fundApprovedPolicy` for the configured controller. The verifier storage adapter accepts an internal object ID, not a URL. The model adapter receives no wallet secret or claim evidence.

## 10. Required error codes

Use HTTP 400 for malformed inputs; 401 for invalid authentication; 403 for forbidden actions; 404 for inaccessible private resources; 409 for state conflicts; 413 for size limits; 422 for unsupported valid-shaped inputs; 429 for rate limits; and 503 for unavailable dependencies.

Required domain codes include `POLICY_IMMUTABLE`, `POLICY_NOT_APPROVED`, `RESERVATION_BUSY`, `RESERVATION_EXPIRED`, `EVIDENCE_NOT_READY`, `UNSUPPORTED_EVIDENCE`, `WRONG_NETWORK`, `WALLET_POLICY_DENIED`, `BUDGET_LIMIT_REACHED`, `SOURCE_DATA_STALE`, `REPORT_LOCKED`, `PAYMENT_NOT_FINAL`, `ALREADY_COLLECTED`, `PROVIDER_UNAVAILABLE`, and `IDEMPOTENCY_CONFLICT`.

Return `404` instead of confirming another user’s private claim or report exists. Log only the request ID and sanitized code.
