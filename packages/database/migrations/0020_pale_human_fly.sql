CREATE TABLE "payout_approval_signatures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"approval_id" uuid NOT NULL,
	"member_user_id" uuid NOT NULL,
	"wallet_id" uuid NOT NULL,
	"message" text NOT NULL,
	"signature" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payout_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"reward" numeric(78, 0) NOT NULL,
	"required_approvals" integer DEFAULT 2 NOT NULL,
	"state" text DEFAULT 'PENDING' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "payout_approvals_claim_id_unique" UNIQUE("claim_id"),
	CONSTRAINT "payout_approval_state" CHECK ("payout_approvals"."state" in ('PENDING','APPROVED','EXPIRED'))
);
--> statement-breakpoint
ALTER TABLE "payout_approval_signatures" ADD CONSTRAINT "payout_approval_signatures_approval_id_payout_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."payout_approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_approval_signatures" ADD CONSTRAINT "payout_approval_signatures_member_user_id_users_id_fk" FOREIGN KEY ("member_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_approval_signatures" ADD CONSTRAINT "payout_approval_signatures_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_approvals" ADD CONSTRAINT "payout_approvals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payout_approval_signature_unique" ON "payout_approval_signatures" USING btree ("approval_id","member_user_id");--> statement-breakpoint
CREATE INDEX "payout_approval_organization" ON "payout_approvals" USING btree ("organization_id");