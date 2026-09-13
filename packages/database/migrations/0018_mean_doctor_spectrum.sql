CREATE TABLE "findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"tier_id" uuid NOT NULL,
	"researcher_user_id" uuid NOT NULL,
	"claim_id" text,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"affected_component" text NOT NULL,
	"self_assessed_severity" text NOT NULL,
	"verdict_severity" text,
	"verdict_reasoning" text,
	"measured_impact" numeric(78, 0),
	"verifier_mode" text,
	"status" text DEFAULT 'SUBMITTED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "findings_claim_id_unique" UNIQUE("claim_id")
);
--> statement-breakpoint
CREATE TABLE "severity_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"name" text NOT NULL,
	"min_reward" numeric(78, 0) NOT NULL,
	"max_reward" numeric(78, 0) NOT NULL,
	"asset" text NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "severity_tier_range" CHECK ("severity_tiers"."min_reward" >= 0 and "severity_tiers"."max_reward" >= "severity_tiers"."min_reward")
);
--> statement-breakpoint
ALTER TABLE "bounties" ADD COLUMN "severity_tier_id" uuid;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "kind" text DEFAULT 'COVERAGE' NOT NULL;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "scope_summary" text;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "rules_summary" text;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "disclosure_policy" text;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "visibility" text DEFAULT 'PRIVATE' NOT NULL;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_tier_id_severity_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."severity_tiers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_researcher_user_id_users_id_fk" FOREIGN KEY ("researcher_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_claim_id_claims_claim_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("claim_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "severity_tiers" ADD CONSTRAINT "severity_tiers_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "finding_program" ON "findings" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "finding_researcher" ON "findings" USING btree ("researcher_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "severity_tier_program_name" ON "severity_tiers" USING btree ("program_id","name");--> statement-breakpoint
ALTER TABLE "bounties" ADD CONSTRAINT "bounties_severity_tier_id_severity_tiers_id_fk" FOREIGN KEY ("severity_tier_id") REFERENCES "public"."severity_tiers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bounty_severity_tier" ON "bounties" USING btree ("severity_tier_id");--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "program_kind" CHECK ("programs"."kind" in ('COVERAGE','FINDINGS'));--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "program_visibility" CHECK ("programs"."visibility" in ('PUBLIC','PRIVATE'));