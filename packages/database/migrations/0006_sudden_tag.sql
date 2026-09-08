CREATE TABLE "funding_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"draft_id" uuid NOT NULL,
	"wallet_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"authorization_wallet_id" uuid NOT NULL,
	"authorization_message" text NOT NULL,
	"authorization_expires_at" timestamp with time zone NOT NULL,
	"authorization_signature" text,
	"approval_intent_id" uuid,
	"funding_intent_id" uuid,
	"state" text DEFAULT 'AWAITING_AUTHORIZATION' NOT NULL,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signed_transactions" (
	"intent_id" uuid PRIMARY KEY NOT NULL,
	"serialized" text NOT NULL,
	"transaction_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "signed_transactions_transaction_hash_unique" UNIQUE("transaction_hash")
);
--> statement-breakpoint
ALTER TABLE "funding_requests" ADD CONSTRAINT "funding_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funding_requests" ADD CONSTRAINT "funding_requests_draft_id_bounty_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."bounty_drafts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funding_requests" ADD CONSTRAINT "funding_requests_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funding_requests" ADD CONSTRAINT "funding_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funding_requests" ADD CONSTRAINT "funding_requests_authorization_wallet_id_wallets_id_fk" FOREIGN KEY ("authorization_wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funding_requests" ADD CONSTRAINT "funding_requests_approval_intent_id_transaction_intents_id_fk" FOREIGN KEY ("approval_intent_id") REFERENCES "public"."transaction_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funding_requests" ADD CONSTRAINT "funding_requests_funding_intent_id_transaction_intents_id_fk" FOREIGN KEY ("funding_intent_id") REFERENCES "public"."transaction_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signed_transactions" ADD CONSTRAINT "signed_transactions_intent_id_transaction_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."transaction_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "one_active_funding_request" ON "funding_requests" USING btree ("draft_id") WHERE "funding_requests"."state" not in ('CANCELLED','EXPIRED');