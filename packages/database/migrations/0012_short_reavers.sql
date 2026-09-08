ALTER TABLE "reports" ADD COLUMN "retention_hold" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "delete_after" timestamp with time zone DEFAULT now() + interval '24 hours';--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "deleted_at" timestamp with time zone;
--> statement-breakpoint
UPDATE uploads SET delete_after=CASE WHEN state='UPLOADING' THEN created_at+interval '24 hours' ELSE NULL END;
--> statement-breakpoint
UPDATE reports SET delete_after=available_at+interval '30 days' WHERE state='AVAILABLE' AND available_at IS NOT NULL;
--> statement-breakpoint
UPDATE reports r SET retention_hold=true FROM assessments a WHERE a.claim_id=r.claim_id AND a.outcome='QUALIFIES' AND r.state='SEALED';
--> statement-breakpoint
CREATE FUNCTION protect_ciphertext_retention() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.state IN ('DELETING','DELETED') AND NEW.state NOT IN ('DELETING','DELETED')
 OR (OLD.state='DELETED' AND NEW.state<>'DELETED')
 OR (OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS DISTINCT FROM OLD.deleted_at) THEN
  RAISE EXCEPTION 'Deleted ciphertext cannot be restored through a state update' USING ERRCODE='23514';
 END IF;
 IF TG_TABLE_NAME='uploads' THEN
  IF ROW(NEW.object_key,NEW.ciphertext_hash,NEW.key_id,NEW.byte_length,NEW.owner_user_id,NEW.bounty_id,NEW.created_at)
  IS DISTINCT FROM ROW(OLD.object_key,OLD.ciphertext_hash,OLD.key_id,OLD.byte_length,OLD.owner_user_id,OLD.bounty_id,OLD.created_at)
  OR (OLD.state<>'UPLOADING' AND OLD.delete_after IS NOT NULL AND NEW.delete_after IS DISTINCT FROM OLD.delete_after) THEN
   RAISE EXCEPTION 'Evidence bindings and scheduled deletion dates are immutable' USING ERRCODE='23514';
  END IF;
 ELSE
  IF ROW(NEW.claim_id,NEW.report_hash,NEW.ciphertext_object_key,NEW.ciphertext_hash,NEW.researcher_object_key,NEW.researcher_ciphertext_hash,NEW.researcher_key_id,NEW.recipient_key_id,NEW.wrapped_key_ref,NEW.created_at)
  IS DISTINCT FROM ROW(OLD.claim_id,OLD.report_hash,OLD.ciphertext_object_key,OLD.ciphertext_hash,OLD.researcher_object_key,OLD.researcher_ciphertext_hash,OLD.researcher_key_id,OLD.recipient_key_id,OLD.wrapped_key_ref,OLD.created_at)
  OR (OLD.state='AVAILABLE' AND ROW(NEW.available_at,NEW.delete_after,NEW.paid_event_ref,NEW.retention_hold) IS DISTINCT FROM ROW(OLD.available_at,OLD.delete_after,OLD.paid_event_ref,OLD.retention_hold))
  OR (OLD.retention_hold AND NOT NEW.retention_hold AND NEW.state<>'AVAILABLE') THEN
   RAISE EXCEPTION 'Report bindings and paid retention terms are immutable' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER upload_retention_immutable BEFORE UPDATE ON uploads FOR EACH ROW EXECUTE FUNCTION protect_ciphertext_retention();
--> statement-breakpoint
CREATE TRIGGER report_retention_immutable BEFORE UPDATE ON reports FOR EACH ROW EXECUTE FUNCTION protect_ciphertext_retention();
