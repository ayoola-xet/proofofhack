CREATE TABLE "assistant_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"question" text NOT NULL,
	"snapshot_json" jsonb NOT NULL,
	"input_hash" text NOT NULL,
	"prompt_version" text NOT NULL,
	"requested_model" text NOT NULL,
	"state" text DEFAULT 'QUEUED' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"answer_json" jsonb,
	"response_id" text,
	"response_model" text,
	"usage_json" jsonb,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assistant_runs" ADD CONSTRAINT "assistant_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_runs" ADD CONSTRAINT "assistant_runs_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_runs_organization" ON "assistant_runs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE FUNCTION protect_assistant_run() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.organization_id, NEW.requested_by, NEW.question, NEW.snapshot_json::text,
      NEW.input_hash, NEW.prompt_version, NEW.requested_model, NEW.created_at)
      IS DISTINCT FROM
     (OLD.organization_id, OLD.requested_by, OLD.question, OLD.snapshot_json::text,
      OLD.input_hash, OLD.prompt_version, OLD.requested_model, OLD.created_at) THEN
    RAISE EXCEPTION 'Assistant request terms are immutable';
  END IF;
  IF OLD.answer_json IS NOT NULL AND
     (NEW.answer_json::text,NEW.response_id,NEW.response_model,NEW.usage_json::text)
      IS DISTINCT FROM
     (OLD.answer_json::text,OLD.response_id,OLD.response_model,OLD.usage_json::text) THEN
    RAISE EXCEPTION 'A completed assistant answer is immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER assistant_run_immutable BEFORE UPDATE ON assistant_runs FOR EACH ROW EXECUTE FUNCTION protect_assistant_run();
