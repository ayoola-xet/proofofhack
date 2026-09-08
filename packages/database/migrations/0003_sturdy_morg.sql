ALTER TABLE "fixture_manifests" ADD COLUMN "organization_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "fixture_manifests" ADD COLUMN "signing_wallet_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "fixture_manifests" ADD COLUMN "status" text DEFAULT 'PREPARED' NOT NULL;--> statement-breakpoint
ALTER TABLE "fixture_manifests" ADD CONSTRAINT "fixture_manifests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixture_manifests" ADD CONSTRAINT "fixture_manifests_signing_wallet_id_wallets_id_fk" FOREIGN KEY ("signing_wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;