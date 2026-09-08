CREATE FUNCTION protect_approved_bounty() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'APPROVED' AND (
    NEW.policy_json IS DISTINCT FROM OLD.policy_json OR
    NEW.policy_hash IS DISTINCT FROM OLD.policy_hash OR
    NEW.program_id IS DISTINCT FROM OLD.program_id OR
    NEW.approved_by IS DISTINCT FROM OLD.approved_by OR
    NEW.status IS DISTINCT FROM OLD.status
  ) THEN
    RAISE EXCEPTION 'Approved bounty policy is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER bounty_approval_guard BEFORE UPDATE ON bounty_drafts FOR EACH ROW EXECUTE FUNCTION protect_approved_bounty();
--> statement-breakpoint
CREATE FUNCTION protect_signed_manifest() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'SIGNED' AND (
    NEW.root IS DISTINCT FROM OLD.root OR
    NEW.owner_signature IS DISTINCT FROM OLD.owner_signature OR
    NEW.source_context_json IS DISTINCT FROM OLD.source_context_json OR
    NEW.organization_id IS DISTINCT FROM OLD.organization_id OR
    NEW.signing_wallet_id IS DISTINCT FROM OLD.signing_wallet_id OR
    NEW.registered_by IS DISTINCT FROM OLD.registered_by OR
    NEW.status IS DISTINCT FROM OLD.status
  ) THEN
    RAISE EXCEPTION 'Signed fixture manifest is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER fixture_signature_guard BEFORE UPDATE ON fixture_manifests FOR EACH ROW EXECUTE FUNCTION protect_signed_manifest();
--> statement-breakpoint
CREATE FUNCTION protect_coverage_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Create a new coverage policy version instead of changing an approved version' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER coverage_policy_guard BEFORE UPDATE ON coverage_policies FOR EACH ROW EXECUTE FUNCTION protect_coverage_policy();
