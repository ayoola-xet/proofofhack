CREATE TABLE "bounty_recovery" (
	"bounty_id" text PRIMARY KEY NOT NULL,
	"checkpoint_block" numeric(78, 0),
	"checkpoint_hash" text,
	"active_intent_id" uuid,
	"status" text DEFAULT 'WAITING' NOT NULL,
	"failure_code" text,
	"observed_state" text,
	"next_check_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bounty_recovery" ADD CONSTRAINT "bounty_recovery_bounty_id_bounties_bounty_id_fk" FOREIGN KEY ("bounty_id") REFERENCES "public"."bounties"("bounty_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bounty_recovery" ADD CONSTRAINT "bounty_recovery_active_intent_id_transaction_intents_id_fk" FOREIGN KEY ("active_intent_id") REFERENCES "public"."transaction_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recovery_due" ON "bounty_recovery" USING btree ("status","next_check_at");--> statement-breakpoint
ALTER TABLE bounty_recovery ADD CONSTRAINT recovery_checkpoint_pair CHECK ((checkpoint_block IS NULL) = (checkpoint_hash IS NULL));
--> statement-breakpoint
CREATE FUNCTION protect_recovery_transaction() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (OLD.purpose IN ('RECOVERY_expireReservation','RECOVERY_refundExpired') OR NEW.purpose IN ('RECOVERY_expireReservation','RECOVERY_refundExpired')) AND (
 ROW(NEW.wallet_id,NEW.chain_id,NEW.provider,NEW.purpose,NEW.request_hash,NEW.idempotency_key,NEW.sender_nonce,NEW.request_json,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.wallet_id,OLD.chain_id,OLD.provider,OLD.purpose,OLD.request_hash,OLD.idempotency_key,OLD.sender_nonce,OLD.request_json,OLD.created_at)
 OR (OLD.transaction_hash IS NOT NULL AND NEW.transaction_hash IS DISTINCT FROM OLD.transaction_hash)
 OR (OLD.provider_request_id IS NOT NULL AND NEW.provider_request_id IS DISTINCT FROM OLD.provider_request_id)) THEN
 RAISE EXCEPTION 'Recovery transaction terms are immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER recovery_transaction_immutable BEFORE UPDATE ON transaction_intents FOR EACH ROW EXECUTE FUNCTION protect_recovery_transaction();
