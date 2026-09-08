CREATE FUNCTION protect_circle_request_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (OLD.provider='CIRCLE' OR NEW.provider='CIRCLE') AND NEW.id IS DISTINCT FROM OLD.id THEN
  RAISE EXCEPTION 'Circle request identity is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER circle_request_identity_immutable BEFORE UPDATE ON transaction_intents FOR EACH ROW EXECUTE FUNCTION protect_circle_request_identity();
