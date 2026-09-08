CREATE TABLE "admissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" text NOT NULL,
	"nonce" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"signature_ref" text,
	"valid_until" timestamp with time zone NOT NULL,
	"state" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "admissions_nonce_unique" UNIQUE("nonce")
);
--> statement-breakpoint
CREATE TABLE "agent_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"controller_id" uuid NOT NULL,
	"recommendation_id" uuid NOT NULL,
	"policy_hash" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"provider_request_id" text,
	"tx_intent_id" uuid,
	"state" text NOT NULL,
	"rejection_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "agent_actions_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "approved_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"controller_id" uuid NOT NULL,
	"policy_hash" text NOT NULL,
	"reward" numeric(78, 0) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_event_ref" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" text NOT NULL,
	"outcome" text NOT NULL,
	"report_hash" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"signature_ref" text,
	"assessed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "assessments_claim_id_unique" UNIQUE("claim_id")
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" text NOT NULL,
	"organization_id" uuid,
	"action" text NOT NULL,
	"resource_id" text NOT NULL,
	"result_code" text NOT NULL,
	"request_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bounties" (
	"bounty_id" text PRIMARY KEY NOT NULL,
	"program_id" uuid NOT NULL,
	"policy_hash" text NOT NULL,
	"policy_json" jsonb NOT NULL,
	"chain_id" text NOT NULL,
	"escrow" text NOT NULL,
	"reward" numeric(78, 0) NOT NULL,
	"unallocated_reward" numeric(78, 0) NOT NULL,
	"claimant_credit" numeric(78, 0) DEFAULT '0' NOT NULL,
	"chain_state" text NOT NULL,
	"creation_tx" text NOT NULL,
	"last_event_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "bounties_policy_hash_unique" UNIQUE("policy_hash"),
	CONSTRAINT "bounty_amounts" CHECK ("bounties"."reward" > 0 and "bounties"."unallocated_reward" >= 0 and "bounties"."claimant_credit" >= 0 and "bounties"."unallocated_reward" + "bounties"."claimant_credit" <= "bounties"."reward")
);
--> statement-breakpoint
CREATE TABLE "bounty_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"policy_json" jsonb NOT NULL,
	"policy_hash" text NOT NULL,
	"created_by" uuid NOT NULL,
	"approved_by" uuid,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_controllers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"chain_id" text NOT NULL,
	"address" text NOT NULL,
	"owner_wallet_id" uuid NOT NULL,
	"operator_wallet_id" uuid NOT NULL,
	"asset" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"limit_projection_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chain_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" text NOT NULL,
	"transaction_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"block_number" numeric(78, 0) NOT NULL,
	"block_hash" text NOT NULL,
	"name" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"finality_state" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"claim_id" text PRIMARY KEY NOT NULL,
	"bounty_id" text NOT NULL,
	"researcher_user_id" uuid NOT NULL,
	"claimant_wallet_id" uuid NOT NULL,
	"claimant_address" text NOT NULL,
	"upload_id" uuid NOT NULL,
	"evidence_commitment" text NOT NULL,
	"case_nullifier" text,
	"job_state" text NOT NULL,
	"reservation_expiry" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "claims_upload_id_unique" UNIQUE("upload_id")
);
--> statement-breakpoint
CREATE TABLE "coverage_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"min_reward" numeric(78, 0) NOT NULL,
	"max_data_age_seconds" integer DEFAULT 300 NOT NULL,
	"allowed_vault_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"approved_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "coverage_reward_positive" CHECK ("coverage_policies"."min_reward" > 0)
);
--> statement-breakpoint
CREATE TABLE "coverage_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vault_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"source_observation_id" uuid NOT NULL,
	"funded_reward" numeric(78, 0) NOT NULL,
	"status" text NOT NULL,
	"reason" text NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fixture_manifests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"root" text NOT NULL,
	"version_number" text NOT NULL,
	"owner_signature" text NOT NULL,
	"source_context_json" jsonb NOT NULL,
	"synthetic" boolean DEFAULT true NOT NULL,
	"registered_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "fixture_manifests_root_unique" UNIQUE("root"),
	CONSTRAINT "fixture_only" CHECK ("fixture_manifests"."synthetic" = true)
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"actor_id" text NOT NULL,
	"route" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_json" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "idempotency_records_actor_id_route_key_pk" PRIMARY KEY("actor_id","route","key")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "memberships_organization_id_user_id_pk" PRIMARY KEY("organization_id","user_id"),
	CONSTRAINT "membership_role" CHECK ("memberships"."role" in ('OWNER','TREASURY','REVIEWER','VIEWER'))
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"onchain_id" text NOT NULL,
	"name" text NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "organizations_onchain_id_unique" UNIQUE("onchain_id")
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deduplication_key" text NOT NULL,
	"event_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "outbox_deduplication_key_unique" UNIQUE("deduplication_key")
);
--> statement-breakpoint
CREATE TABLE "programs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"coverage_policy_id" uuid,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"claimant_user_id" uuid,
	"bounty_id" text,
	"category" text NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"asset" text NOT NULL,
	"event_id" uuid NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recommendations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source_ids" jsonb NOT NULL,
	"policy_id" uuid,
	"calculation_json" jsonb NOT NULL,
	"explanation" text NOT NULL,
	"action_json" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registered_vaults" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source_chain_id" text NOT NULL,
	"address" text NOT NULL,
	"asset" text,
	"decimals" integer,
	"label" text NOT NULL,
	"fixture_scope" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" text NOT NULL,
	"report_hash" text NOT NULL,
	"ciphertext_object_key" text NOT NULL,
	"wrapped_key_ref" text NOT NULL,
	"recipient_key_id" text NOT NULL,
	"state" text NOT NULL,
	"paid_event_ref" uuid,
	"available_at" timestamp with time zone,
	"delete_after" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "reports_claim_id_unique" UNIQUE("claim_id"),
	CONSTRAINT "report_payment_required" CHECK ("reports"."state" <> 'AVAILABLE' or ("reports"."paid_event_ref" is not null and "reports"."available_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "transaction_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" text NOT NULL,
	"provider" text NOT NULL,
	"wallet_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"request_hash" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"provider_request_id" text,
	"sender_nonce" numeric(78, 0),
	"transaction_hash" text,
	"state" text NOT NULL,
	"request_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"bounty_id" text NOT NULL,
	"object_key" text NOT NULL,
	"ciphertext_hash" text NOT NULL,
	"key_id" text NOT NULL,
	"byte_length" integer NOT NULL,
	"state" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "uploads_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "upload_size" CHECK ("uploads"."byte_length" > 0 and "uploads"."byte_length" <= 262192)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"privy_user_id" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "users_privy_user_id_unique" UNIQUE("privy_user_id")
);
--> statement-breakpoint
CREATE TABLE "vault_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vault_id" uuid NOT NULL,
	"provider_deployment_id" text NOT NULL,
	"schema_version" text NOT NULL,
	"observed_block" numeric(78, 0) NOT NULL,
	"observed_hash" text,
	"indexed_head" numeric(78, 0) NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metrics_json" jsonb NOT NULL,
	"read_status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_wallet_id" text NOT NULL,
	"owner_type" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"chain_id" text NOT NULL,
	"address" text NOT NULL,
	"policy_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admissions" ADD CONSTRAINT "admissions_claim_id_claims_claim_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("claim_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_controller_id_budget_controllers_id_fk" FOREIGN KEY ("controller_id") REFERENCES "public"."budget_controllers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_recommendation_id_recommendations_id_fk" FOREIGN KEY ("recommendation_id") REFERENCES "public"."recommendations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_tx_intent_id_transaction_intents_id_fk" FOREIGN KEY ("tx_intent_id") REFERENCES "public"."transaction_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approved_allocations" ADD CONSTRAINT "approved_allocations_controller_id_budget_controllers_id_fk" FOREIGN KEY ("controller_id") REFERENCES "public"."budget_controllers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approved_allocations" ADD CONSTRAINT "approved_allocations_consumed_event_ref_chain_events_id_fk" FOREIGN KEY ("consumed_event_ref") REFERENCES "public"."chain_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_claim_id_claims_claim_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("claim_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bounties" ADD CONSTRAINT "bounties_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bounty_drafts" ADD CONSTRAINT "bounty_drafts_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bounty_drafts" ADD CONSTRAINT "bounty_drafts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bounty_drafts" ADD CONSTRAINT "bounty_drafts_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_controllers" ADD CONSTRAINT "budget_controllers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_controllers" ADD CONSTRAINT "budget_controllers_owner_wallet_id_wallets_id_fk" FOREIGN KEY ("owner_wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_controllers" ADD CONSTRAINT "budget_controllers_operator_wallet_id_wallets_id_fk" FOREIGN KEY ("operator_wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_bounty_id_bounties_bounty_id_fk" FOREIGN KEY ("bounty_id") REFERENCES "public"."bounties"("bounty_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_researcher_user_id_users_id_fk" FOREIGN KEY ("researcher_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_claimant_wallet_id_wallets_id_fk" FOREIGN KEY ("claimant_wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_upload_id_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."uploads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverage_policies" ADD CONSTRAINT "coverage_policies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverage_policies" ADD CONSTRAINT "coverage_policies_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverage_records" ADD CONSTRAINT "coverage_records_vault_id_registered_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."registered_vaults"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverage_records" ADD CONSTRAINT "coverage_records_policy_id_coverage_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."coverage_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverage_records" ADD CONSTRAINT "coverage_records_source_observation_id_vault_observations_id_fk" FOREIGN KEY ("source_observation_id") REFERENCES "public"."vault_observations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixture_manifests" ADD CONSTRAINT "fixture_manifests_registered_by_users_id_fk" FOREIGN KEY ("registered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_coverage_policy_id_coverage_policies_id_fk" FOREIGN KEY ("coverage_policy_id") REFERENCES "public"."coverage_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_claimant_user_id_users_id_fk" FOREIGN KEY ("claimant_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_bounty_id_bounties_bounty_id_fk" FOREIGN KEY ("bounty_id") REFERENCES "public"."bounties"("bounty_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_event_id_chain_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."chain_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_policy_id_coverage_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."coverage_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registered_vaults" ADD CONSTRAINT "registered_vaults_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_claim_id_claims_claim_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("claim_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_paid_event_ref_chain_events_id_fk" FOREIGN KEY ("paid_event_ref") REFERENCES "public"."chain_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_intents" ADD CONSTRAINT "transaction_intents_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_bounty_id_bounties_bounty_id_fk" FOREIGN KEY ("bounty_id") REFERENCES "public"."bounties"("bounty_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_observations" ADD CONSTRAINT "vault_observations_vault_id_registered_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."registered_vaults"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "allocation_unique" ON "approved_allocations" USING btree ("controller_id","policy_hash");--> statement-breakpoint
CREATE INDEX "bounty_program" ON "bounties" USING btree ("program_id");--> statement-breakpoint
CREATE UNIQUE INDEX "controller_unique" ON "budget_controllers" USING btree ("organization_id","chain_id","address");--> statement-breakpoint
CREATE UNIQUE INDEX "chain_event_unique" ON "chain_events" USING btree ("chain_id","transaction_hash","log_index");--> statement-breakpoint
CREATE INDEX "claim_owner" ON "claims" USING btree ("researcher_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "one_projected_reservation" ON "claims" USING btree ("bounty_id") WHERE "claims"."job_state" in ('RESERVED','VERIFYING','ASSESSED','SETTLEMENT_PENDING');--> statement-breakpoint
CREATE UNIQUE INDEX "coverage_policy_version" ON "coverage_policies" USING btree ("organization_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "coverage_record_unique" ON "coverage_records" USING btree ("vault_id","policy_id","source_observation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "program_org_name" ON "programs" USING btree ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "receipt_unique" ON "receipts" USING btree ("event_id","category");--> statement-breakpoint
CREATE UNIQUE INDEX "registered_vault_unique" ON "registered_vaults" USING btree ("organization_id","source_chain_id","address");--> statement-breakpoint
CREATE UNIQUE INDEX "intent_idempotency" ON "transaction_intents" USING btree ("wallet_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "intent_reconciliation" ON "transaction_intents" USING btree ("state");--> statement-breakpoint
CREATE UNIQUE INDEX "observation_unique" ON "vault_observations" USING btree ("provider_deployment_id","vault_id","observed_block");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_provider_unique" ON "wallets" USING btree ("provider","provider_wallet_id","chain_id");--> statement-breakpoint
CREATE INDEX "wallet_owner" ON "wallets" USING btree ("owner_id");