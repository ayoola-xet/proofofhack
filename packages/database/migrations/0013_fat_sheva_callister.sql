ALTER TABLE "reports" ADD COLUMN "expiry_event_ref" uuid;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_expiry_event_ref_chain_events_id_fk" FOREIGN KEY ("expiry_event_ref") REFERENCES "public"."chain_events"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_ciphertext_retention() RETURNS trigger LANGUAGE plpgsql AS $$
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
  OR (OLD.expiry_event_ref IS NOT NULL AND ROW(NEW.expiry_event_ref,NEW.delete_after,NEW.retention_hold,NEW.paid_event_ref,NEW.available_at) IS DISTINCT FROM ROW(OLD.expiry_event_ref,OLD.delete_after,OLD.retention_hold,OLD.paid_event_ref,OLD.available_at))
  OR (OLD.retention_hold AND NOT NEW.retention_hold AND NEW.state<>'AVAILABLE' AND NEW.expiry_event_ref IS NULL) THEN
   RAISE EXCEPTION 'Report bindings and paid retention terms are immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.expiry_event_ref IS NOT NULL AND (
   NEW.retention_hold OR NEW.paid_event_ref IS NOT NULL OR NEW.available_at IS NOT NULL OR NEW.state='AVAILABLE'
   OR NOT EXISTS (
    SELECT 1 FROM chain_events e JOIN claims c ON c.claim_id=NEW.claim_id
    JOIN bounties b ON b.bounty_id=c.bounty_id
    WHERE e.id=NEW.expiry_event_ref AND e.name='ReservationExpired' AND e.finality_state='FINAL'
    AND e.chain_id=b.chain_id AND e.contract_address=b.escrow
    AND e.payload_json->>'claimId'=c.claim_id AND e.payload_json->>'bountyId'=c.bounty_id
   )
  ) THEN
   RAISE EXCEPTION 'Report expiry requires the matching final reservation event' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
