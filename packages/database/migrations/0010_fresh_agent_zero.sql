CREATE UNIQUE INDEX "agent_action_policy" ON "agent_actions" USING btree ("controller_id","policy_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "controller_organization_chain" ON "budget_controllers" USING btree ("organization_id","chain_id");--> statement-breakpoint
CREATE FUNCTION protect_controller_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.organization_id,NEW.chain_id,NEW.address,NEW.owner_wallet_id,NEW.operator_wallet_id,NEW.asset,
     NEW.limit_projection_json->>'escrow',NEW.limit_projection_json->'deploymentProof') IS DISTINCT FROM
    (OLD.organization_id,OLD.chain_id,OLD.address,OLD.owner_wallet_id,OLD.operator_wallet_id,OLD.asset,
     OLD.limit_projection_json->>'escrow',OLD.limit_projection_json->'deploymentProof') THEN
  RAISE EXCEPTION 'Controller bindings are immutable';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER controller_binding_immutable BEFORE UPDATE ON budget_controllers FOR EACH ROW EXECUTE FUNCTION protect_controller_binding();
--> statement-breakpoint
CREATE FUNCTION protect_budget_intent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.purpose='BUDGET_ALLOCATION' OR NEW.purpose='BUDGET_ALLOCATION' THEN
  IF (NEW.chain_id,NEW.provider,NEW.wallet_id,NEW.purpose,NEW.request_hash,NEW.idempotency_key,NEW.request_json::text) IS DISTINCT FROM
     (OLD.chain_id,OLD.provider,OLD.wallet_id,OLD.purpose,OLD.request_hash,OLD.idempotency_key,OLD.request_json::text) OR
     (OLD.transaction_hash IS NOT NULL AND NEW.transaction_hash IS DISTINCT FROM OLD.transaction_hash) THEN
   RAISE EXCEPTION 'Budget transaction terms are immutable';
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER budget_intent_immutable BEFORE UPDATE ON transaction_intents FOR EACH ROW EXECUTE FUNCTION protect_budget_intent();
--> statement-breakpoint
CREATE FUNCTION protect_agent_action() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.controller_id,NEW.policy_hash,NEW.idempotency_key) IS DISTINCT FROM
    (OLD.controller_id,OLD.policy_hash,OLD.idempotency_key) OR
    (OLD.tx_intent_id IS NOT NULL AND (NEW.tx_intent_id,NEW.recommendation_id) IS DISTINCT FROM (OLD.tx_intent_id,OLD.recommendation_id)) THEN
  RAISE EXCEPTION 'Agent action bindings are immutable';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER agent_action_immutable BEFORE UPDATE ON agent_actions FOR EACH ROW EXECUTE FUNCTION protect_agent_action();
