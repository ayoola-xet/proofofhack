-- Custom SQL migration file, put your code below! --
CREATE FUNCTION protect_funding_authorization() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.organization_id,NEW.draft_id,NEW.wallet_id,NEW.requested_by,NEW.authorization_wallet_id,NEW.authorization_message,NEW.authorization_expires_at)
    IS DISTINCT FROM ROW(OLD.organization_id,OLD.draft_id,OLD.wallet_id,OLD.requested_by,OLD.authorization_wallet_id,OLD.authorization_message,OLD.authorization_expires_at)
    OR (OLD.authorization_signature IS NOT NULL AND NEW.authorization_signature IS DISTINCT FROM OLD.authorization_signature)
    OR (OLD.approval_intent_id IS NOT NULL AND NEW.approval_intent_id IS DISTINCT FROM OLD.approval_intent_id)
    OR (OLD.funding_intent_id IS NOT NULL AND NEW.funding_intent_id IS DISTINCT FROM OLD.funding_intent_id)
  THEN RAISE EXCEPTION 'Funding authorization and saved intent links are immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER funding_authorization_immutable BEFORE UPDATE ON funding_requests FOR EACH ROW EXECUTE FUNCTION protect_funding_authorization();
--> statement-breakpoint
CREATE FUNCTION protect_funding_transaction() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.purpose IN ('BOUNTY_APPROVE','BOUNTY_FUND') AND (
    ROW(NEW.wallet_id,NEW.chain_id,NEW.provider,NEW.purpose,NEW.request_hash,NEW.idempotency_key,NEW.sender_nonce,NEW.request_json)
    IS DISTINCT FROM ROW(OLD.wallet_id,OLD.chain_id,OLD.provider,OLD.purpose,OLD.request_hash,OLD.idempotency_key,OLD.sender_nonce,OLD.request_json)
    OR (OLD.transaction_hash IS NOT NULL AND NEW.transaction_hash IS DISTINCT FROM OLD.transaction_hash)
  ) THEN RAISE EXCEPTION 'Funding transaction terms are immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER funding_transaction_immutable BEFORE UPDATE ON transaction_intents FOR EACH ROW EXECUTE FUNCTION protect_funding_transaction();
--> statement-breakpoint
CREATE FUNCTION protect_signed_transaction() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Signed transaction records are immutable' USING ERRCODE='23514';
END $$;
--> statement-breakpoint
CREATE TRIGGER signed_transaction_immutable BEFORE UPDATE ON signed_transactions FOR EACH ROW EXECUTE FUNCTION protect_signed_transaction();
--> statement-breakpoint
CREATE UNIQUE INDEX treasury_sender_nonce_unique ON transaction_intents(wallet_id,sender_nonce) WHERE purpose IN ('BOUNTY_APPROVE','BOUNTY_FUND');
