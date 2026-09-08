CREATE TABLE "receipt_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"snapshot_json" jsonb NOT NULL,
	"input_hash" text NOT NULL,
	"state" text DEFAULT 'QUEUED' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"csv" text,
	"content_hash" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "receipt_exports" ADD CONSTRAINT "receipt_exports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_exports" ADD CONSTRAINT "receipt_exports_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE receipt_exports ADD CONSTRAINT receipt_export_state CHECK (state IN ('QUEUED','RUNNING','RETRYING','READY','FAILED','CANCELLED'));
--> statement-breakpoint
ALTER TABLE receipt_exports ADD CONSTRAINT receipt_export_ready CHECK ((state='READY') = (csv IS NOT NULL AND content_hash IS NOT NULL AND completed_at IS NOT NULL));
--> statement-breakpoint
ALTER TABLE receipt_exports ADD CONSTRAINT receipt_export_hash CHECK (csv IS NULL OR content_hash=encode(sha256(convert_to(csv,'UTF8')),'hex'));
--> statement-breakpoint
CREATE FUNCTION protect_receipt_export() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.id,NEW.organization_id,NEW.requested_by,NEW.snapshot_json,NEW.input_hash) IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.requested_by,OLD.snapshot_json,OLD.input_hash) THEN
  RAISE EXCEPTION 'Export request is immutable' USING ERRCODE='23514';
 END IF;
 IF OLD.state='READY' AND (NEW.state,NEW.csv,NEW.content_hash,NEW.completed_at) IS DISTINCT FROM (OLD.state,OLD.csv,OLD.content_hash,OLD.completed_at) THEN
  RAISE EXCEPTION 'Completed export is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER receipt_export_immutable BEFORE UPDATE ON receipt_exports FOR EACH ROW EXECUTE FUNCTION protect_receipt_export();
