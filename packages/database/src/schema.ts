import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const dates = () => ({
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  version: integer("version").default(1).notNull(),
});
const amount = (name: string) => numeric(name, { precision: 78, scale: 0 });
const json = (name: string) => jsonb(name).$type<Record<string, unknown>>();

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  privyUserId: text("privy_user_id").unique().notNull(),
  displayName: text("display_name").notNull(),
  ...dates(),
});
export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  onchainId: text("onchain_id").notNull().unique(),
  name: text("name").notNull(),
  ownerUserId: uuid("owner_user_id")
    .notNull()
    .references(() => users.id),
  status: text("status").notNull().default("ACTIVE"),
  ...dates(),
});
export const memberships = pgTable(
  "memberships",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role").notNull(),
    status: text("status").notNull().default("ACTIVE"),
    ...dates(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.userId] }),
    check("membership_role", sql`${t.role} in ('OWNER','TREASURY','REVIEWER','VIEWER')`),
  ],
);
export const wallets = pgTable(
  "wallets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    providerWalletId: text("provider_wallet_id").notNull(),
    ownerType: text("owner_type").notNull(),
    ownerId: uuid("owner_id").notNull(),
    chainId: text("chain_id").notNull(),
    address: text("address").notNull(),
    policyRef: text("policy_ref"),
    ...dates(),
  },
  (t) => [
    uniqueIndex("wallet_provider_unique").on(t.provider, t.providerWalletId, t.chainId),
    index("wallet_owner").on(t.ownerId),
  ],
);
export const coveragePolicies = pgTable(
  "coverage_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    versionNumber: integer("version_number").notNull(),
    minReward: amount("min_reward").notNull(),
    maxDataAgeSeconds: integer("max_data_age_seconds").notNull().default(300),
    allowedVaultIds: jsonb("allowed_vault_ids").$type<string[]>().notNull().default([]),
    approvedBy: uuid("approved_by")
      .notNull()
      .references(() => users.id),
    ...dates(),
  },
  (t) => [
    uniqueIndex("coverage_policy_version").on(t.organizationId, t.versionNumber),
    check("coverage_reward_positive", sql`${t.minReward} > 0`),
  ],
);
export const programs = pgTable(
  "programs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    coveragePolicyId: uuid("coverage_policy_id").references(() => coveragePolicies.id),
    status: text("status").notNull().default("ACTIVE"),
    ...dates(),
  },
  (t) => [uniqueIndex("program_org_name").on(t.organizationId, t.name)],
);
export const registeredVaults = pgTable(
  "registered_vaults",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    sourceChainId: text("source_chain_id").notNull(),
    address: text("address").notNull(),
    asset: text("asset"),
    decimals: integer("decimals"),
    label: text("label").notNull(),
    fixtureScope: boolean("fixture_scope").notNull().default(false),
    ...dates(),
  },
  (t) => [uniqueIndex("registered_vault_unique").on(t.organizationId, t.sourceChainId, t.address)],
);
export const vaultObservations = pgTable(
  "vault_observations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vaultId: uuid("vault_id")
      .notNull()
      .references(() => registeredVaults.id),
    providerDeploymentId: text("provider_deployment_id").notNull(),
    schemaVersion: text("schema_version").notNull(),
    observedBlock: amount("observed_block").notNull(),
    observedHash: text("observed_hash"),
    indexedHead: amount("indexed_head").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull(),
    metrics: json("metrics_json").notNull(),
    readStatus: text("read_status").notNull(),
    ...dates(),
  },
  (t) => [uniqueIndex("observation_unique").on(t.providerDeploymentId, t.vaultId, t.observedBlock)],
);
export const coverageRecords = pgTable(
  "coverage_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vaultId: uuid("vault_id")
      .notNull()
      .references(() => registeredVaults.id),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => coveragePolicies.id),
    sourceObservationId: uuid("source_observation_id")
      .notNull()
      .references(() => vaultObservations.id),
    fundedReward: amount("funded_reward").notNull(),
    status: text("status").notNull(),
    reason: text("reason").notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).defaultNow().notNull(),
    ...dates(),
  },
  (t) => [uniqueIndex("coverage_record_unique").on(t.vaultId, t.policyId, t.sourceObservationId)],
);
export const recommendations = pgTable("recommendations", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  sourceIds: jsonb("source_ids").$type<string[]>().notNull(),
  policyId: uuid("policy_id").references(() => coveragePolicies.id),
  calculation: json("calculation_json").notNull(),
  explanation: text("explanation").notNull(),
  action: json("action_json"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  status: text("status").notNull(),
  ...dates(),
});
export const fixtureManifests = pgTable(
  "fixture_manifests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    signingWalletId: uuid("signing_wallet_id")
      .notNull()
      .references(() => wallets.id),
    status: text("status").notNull().default("PREPARED"),
    root: text("root").notNull().unique(),
    versionNumber: text("version_number").notNull(),
    ownerSignature: text("owner_signature").notNull(),
    sourceContext: json("source_context_json").notNull(),
    synthetic: boolean("synthetic").notNull().default(true),
    registeredBy: uuid("registered_by")
      .notNull()
      .references(() => users.id),
    ...dates(),
  },
  (t) => [check("fixture_only", sql`${t.synthetic} = true`)],
);
export const bountyDrafts = pgTable("bounty_drafts", {
  id: uuid("id").primaryKey().defaultRandom(),
  programId: uuid("program_id")
    .notNull()
    .references(() => programs.id),
  policy: json("policy_json").notNull(),
  policyHash: text("policy_hash").notNull(),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id),
  approvedBy: uuid("approved_by").references(() => users.id),
  status: text("status").notNull().default("DRAFT"),
  ...dates(),
});
export const bounties = pgTable(
  "bounties",
  {
    bountyId: text("bounty_id").primaryKey(),
    programId: uuid("program_id")
      .notNull()
      .references(() => programs.id),
    policyHash: text("policy_hash").notNull().unique(),
    policy: json("policy_json").notNull(),
    chainId: text("chain_id").notNull(),
    escrow: text("escrow").notNull(),
    reward: amount("reward").notNull(),
    unallocatedReward: amount("unallocated_reward").notNull(),
    claimantCredit: amount("claimant_credit").notNull().default("0"),
    chainState: text("chain_state").notNull(),
    creationTx: text("creation_tx").notNull(),
    lastEventKey: text("last_event_key"),
    ...dates(),
  },
  (t) => [
    index("bounty_program").on(t.programId),
    check(
      "bounty_amounts",
      sql`${t.reward} > 0 and ${t.unallocatedReward} >= 0 and ${t.claimantCredit} >= 0 and ${t.unallocatedReward} + ${t.claimantCredit} <= ${t.reward}`,
    ),
  ],
);
export const uploads = pgTable(
  "uploads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id),
    bountyId: text("bounty_id")
      .notNull()
      .references(() => bounties.bountyId),
    objectKey: text("object_key").notNull().unique(),
    ciphertextHash: text("ciphertext_hash").notNull(),
    keyId: text("key_id").notNull(),
    byteLength: integer("byte_length").notNull(),
    state: text("state").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...dates(),
  },
  (t) => [check("upload_size", sql`${t.byteLength} > 0 and ${t.byteLength} <= 262192`)],
);
export const claims = pgTable(
  "claims",
  {
    claimId: text("claim_id").primaryKey(),
    bountyId: text("bounty_id")
      .notNull()
      .references(() => bounties.bountyId),
    researcherUserId: uuid("researcher_user_id")
      .notNull()
      .references(() => users.id),
    claimantWalletId: uuid("claimant_wallet_id")
      .notNull()
      .references(() => wallets.id),
    claimantAddress: text("claimant_address").notNull(),
    uploadId: uuid("upload_id")
      .notNull()
      .unique()
      .references(() => uploads.id),
    evidenceCommitment: text("evidence_commitment").notNull(),
    caseNullifier: text("case_nullifier"),
    jobState: text("job_state").notNull(),
    reservationExpiry: timestamp("reservation_expiry", { withTimezone: true }),
    ...dates(),
  },
  (t) => [
    index("claim_owner").on(t.researcherUserId),
    uniqueIndex("one_projected_reservation")
      .on(t.bountyId)
      .where(sql`${t.jobState} in ('RESERVED','VERIFYING','ASSESSED','SETTLEMENT_PENDING')`),
  ],
);
export const admissions = pgTable("admissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  claimId: text("claim_id")
    .notNull()
    .references(() => claims.claimId),
  nonce: text("nonce").notNull().unique(),
  payload: json("payload_json").notNull(),
  signatureRef: text("signature_ref"),
  validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
  state: text("state").notNull(),
  ...dates(),
});
export const assessments = pgTable("assessments", {
  id: uuid("id").primaryKey().defaultRandom(),
  claimId: text("claim_id")
    .notNull()
    .unique()
    .references(() => claims.claimId),
  outcome: text("outcome").notNull(),
  reportHash: text("report_hash").notNull(),
  payload: json("payload_json").notNull(),
  signatureRef: text("signature_ref"),
  assessedAt: timestamp("assessed_at", { withTimezone: true }).notNull(),
  ...dates(),
});
export const chainEvents = pgTable(
  "chain_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chainId: text("chain_id").notNull(),
    contractAddress: text("contract_address").notNull(),
    transactionHash: text("transaction_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    blockNumber: amount("block_number").notNull(),
    blockHash: text("block_hash").notNull(),
    name: text("name").notNull(),
    payload: json("payload_json").notNull(),
    finalityState: text("finality_state").notNull(),
    ...dates(),
  },
  (t) => [uniqueIndex("chain_event_unique").on(t.chainId, t.transactionHash, t.logIndex)],
);
export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    claimId: text("claim_id")
      .notNull()
      .unique()
      .references(() => claims.claimId),
    reportHash: text("report_hash").notNull(),
    ciphertextObjectKey: text("ciphertext_object_key").notNull(),
    wrappedKeyRef: text("wrapped_key_ref").notNull(),
    recipientKeyId: text("recipient_key_id").notNull(),
    state: text("state").notNull(),
    paidEventRef: uuid("paid_event_ref").references(() => chainEvents.id),
    availableAt: timestamp("available_at", { withTimezone: true }),
    deleteAfter: timestamp("delete_after", { withTimezone: true }).notNull(),
    ...dates(),
  },
  (t) => [
    check(
      "report_payment_required",
      sql`${t.state} <> 'AVAILABLE' or (${t.paidEventRef} is not null and ${t.availableAt} is not null)`,
    ),
  ],
);
export const budgetControllers = pgTable(
  "budget_controllers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    chainId: text("chain_id").notNull(),
    address: text("address").notNull(),
    ownerWalletId: uuid("owner_wallet_id")
      .notNull()
      .references(() => wallets.id),
    operatorWalletId: uuid("operator_wallet_id")
      .notNull()
      .references(() => wallets.id),
    asset: text("asset").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    limitProjection: json("limit_projection_json").notNull(),
    ...dates(),
  },
  (t) => [uniqueIndex("controller_unique").on(t.organizationId, t.chainId, t.address)],
);
export const approvedAllocations = pgTable(
  "approved_allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    controllerId: uuid("controller_id")
      .notNull()
      .references(() => budgetControllers.id),
    policyHash: text("policy_hash").notNull(),
    reward: amount("reward").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedEventRef: uuid("consumed_event_ref").references(() => chainEvents.id),
    ...dates(),
  },
  (t) => [uniqueIndex("allocation_unique").on(t.controllerId, t.policyHash)],
);
export const transactionIntents = pgTable(
  "transaction_intents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chainId: text("chain_id").notNull(),
    provider: text("provider").notNull(),
    walletId: uuid("wallet_id")
      .notNull()
      .references(() => wallets.id),
    purpose: text("purpose").notNull(),
    requestHash: text("request_hash").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    providerRequestId: text("provider_request_id"),
    senderNonce: amount("sender_nonce"),
    transactionHash: text("transaction_hash"),
    state: text("state").notNull(),
    request: json("request_json").notNull(),
    ...dates(),
  },
  (t) => [
    uniqueIndex("intent_idempotency").on(t.walletId, t.idempotencyKey),
    index("intent_reconciliation").on(t.state),
  ],
);
export const agentActions = pgTable("agent_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  controllerId: uuid("controller_id")
    .notNull()
    .references(() => budgetControllers.id),
  recommendationId: uuid("recommendation_id")
    .notNull()
    .references(() => recommendations.id),
  policyHash: text("policy_hash").notNull(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  providerRequestId: text("provider_request_id"),
  txIntentId: uuid("tx_intent_id").references(() => transactionIntents.id),
  state: text("state").notNull(),
  rejectionCode: text("rejection_code"),
  ...dates(),
});
export const receipts = pgTable(
  "receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    claimantUserId: uuid("claimant_user_id").references(() => users.id),
    bountyId: text("bounty_id").references(() => bounties.bountyId),
    category: text("category").notNull(),
    amount: amount("amount").notNull(),
    asset: text("asset").notNull(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => chainEvents.id),
    status: text("status").notNull(),
    ...dates(),
  },
  (t) => [uniqueIndex("receipt_unique").on(t.eventId, t.category)],
);
export const outbox = pgTable("outbox", {
  id: uuid("id").primaryKey().defaultRandom(),
  deduplicationKey: text("deduplication_key").notNull().unique(),
  eventType: text("event_type").notNull(),
  aggregateId: text("aggregate_id").notNull(),
  payload: json("payload_json").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  ...dates(),
});
export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorId: text("actor_id").notNull(),
  organizationId: uuid("organization_id"),
  action: text("action").notNull(),
  resourceId: text("resource_id").notNull(),
  resultCode: text("result_code").notNull(),
  requestId: text("request_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
export const idempotencyRecords = pgTable(
  "idempotency_records",
  {
    actorId: text("actor_id").notNull(),
    route: text("route").notNull(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    response: json("response_json"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...dates(),
  },
  (t) => [primaryKey({ columns: [t.actorId, t.route, t.key] })],
);

export const organizationKeys = pgTable(
  "organization_keys",
  {
    keyId: text("key_id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    publicKey: text("public_key").notNull(),
    status: text("status").notNull().default("ACTIVE"),
    ...dates(),
  },
  (t) => [
    uniqueIndex("one_active_organization_key")
      .on(t.organizationId)
      .where(sql`${t.status}='ACTIVE'`),
  ],
);
