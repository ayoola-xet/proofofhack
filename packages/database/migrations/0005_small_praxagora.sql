CREATE TABLE "wallet_setups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"max_per_action" numeric(78, 0) NOT NULL,
	"provider_policy_id" text,
	"provider_wallet_id" text,
	"owner_id" text,
	"wallet_id" uuid,
	"state" text DEFAULT 'QUEUED' NOT NULL,
	"configuration_json" jsonb NOT NULL,
	"attempt_started_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "wallet_setups_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
ALTER TABLE "wallet_setups" ADD CONSTRAINT "wallet_setups_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_setups" ADD CONSTRAINT "wallet_setups_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_setups" ADD CONSTRAINT "wallet_setups_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;