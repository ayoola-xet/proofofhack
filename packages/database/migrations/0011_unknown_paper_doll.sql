CREATE TABLE "owner_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"controller_id" uuid NOT NULL,
	"wallet_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"authorization_wallet_id" uuid NOT NULL,
	"command_json" jsonb NOT NULL,
	"authorization_message" text NOT NULL,
	"authorization_expires_at" timestamp with time zone NOT NULL,
	"authorization_signature" text,
	"tx_intent_id" uuid,
	"permission_pending" boolean DEFAULT false NOT NULL,
	"state" text DEFAULT 'AWAITING_AUTHORIZATION' NOT NULL,
	"failure_code" text,
	"receipt_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "owner_requests" ADD CONSTRAINT "owner_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_requests" ADD CONSTRAINT "owner_requests_controller_id_budget_controllers_id_fk" FOREIGN KEY ("controller_id") REFERENCES "public"."budget_controllers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_requests" ADD CONSTRAINT "owner_requests_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_requests" ADD CONSTRAINT "owner_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_requests" ADD CONSTRAINT "owner_requests_authorization_wallet_id_wallets_id_fk" FOREIGN KEY ("authorization_wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_requests" ADD CONSTRAINT "owner_requests_tx_intent_id_transaction_intents_id_fk" FOREIGN KEY ("tx_intent_id") REFERENCES "public"."transaction_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "one_active_owner_request" ON "owner_requests" USING btree ("wallet_id") WHERE "owner_requests"."state" not in ('COMPLETE','CANCELLED','EXPIRED','FAILED');--> statement-breakpoint
CREATE FUNCTION protect_owner_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.organization_id,NEW.controller_id,NEW.wallet_id,NEW.requested_by,NEW.authorization_wallet_id,NEW.command_json,NEW.authorization_message,NEW.authorization_expires_at)
 IS DISTINCT FROM ROW(OLD.organization_id,OLD.controller_id,OLD.wallet_id,OLD.requested_by,OLD.authorization_wallet_id,OLD.command_json,OLD.authorization_message,OLD.authorization_expires_at)
 OR (OLD.authorization_signature IS NOT NULL AND NEW.authorization_signature IS DISTINCT FROM OLD.authorization_signature)
 OR (OLD.tx_intent_id IS NOT NULL AND NEW.tx_intent_id IS DISTINCT FROM OLD.tx_intent_id)
 OR (OLD.receipt_json IS NOT NULL AND NEW.receipt_json IS DISTINCT FROM OLD.receipt_json)
 OR (OLD.state='COMPLETE' AND NEW.state<>'COMPLETE') THEN
 RAISE EXCEPTION 'Owner authorization and transaction bindings are immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER owner_request_immutable BEFORE UPDATE ON owner_requests FOR EACH ROW EXECUTE FUNCTION protect_owner_request();
--> statement-breakpoint
CREATE FUNCTION protect_owner_transaction() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (OLD.purpose='CONTROLLER_OWNER' OR NEW.purpose='CONTROLLER_OWNER') AND (
 ROW(NEW.wallet_id,NEW.chain_id,NEW.provider,NEW.purpose,NEW.request_hash,NEW.idempotency_key,NEW.sender_nonce,NEW.request_json)
 IS DISTINCT FROM ROW(OLD.wallet_id,OLD.chain_id,OLD.provider,OLD.purpose,OLD.request_hash,OLD.idempotency_key,OLD.sender_nonce,OLD.request_json)
 OR (OLD.transaction_hash IS NOT NULL AND NEW.transaction_hash IS DISTINCT FROM OLD.transaction_hash)) THEN
 RAISE EXCEPTION 'Owner transaction terms are immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER owner_transaction_immutable BEFORE UPDATE ON transaction_intents FOR EACH ROW EXECUTE FUNCTION protect_owner_transaction();
--> statement-breakpoint
CREATE UNIQUE INDEX privy_owner_nonce_unique ON transaction_intents(wallet_id,sender_nonce) WHERE purpose IN ('BOUNTY_APPROVE','BOUNTY_FUND','CONTROLLER_OWNER');
