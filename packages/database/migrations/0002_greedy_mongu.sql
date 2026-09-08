CREATE TABLE "organization_keys" (
	"key_id" text PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"public_key" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization_keys" ADD CONSTRAINT "organization_keys_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "one_active_organization_key" ON "organization_keys" USING btree ("organization_id") WHERE "organization_keys"."status"='ACTIVE';