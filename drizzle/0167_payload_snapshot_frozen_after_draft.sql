CREATE FUNCTION refuse_frozen_submission_payload_update() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  frozen boolean := OLD.status <> 'draft'
    OR NEW.status <> 'draft'
    OR OLD.payload_snapshot_frozen;
BEGIN
  -- The journaled key holds registry recovery identities, not the reviewed
  -- payload; rejected-attempt recovery appends to it after the freeze.
  IF frozen AND (NEW.payload_snapshot - 'journaled')
    IS DISTINCT FROM (OLD.payload_snapshot - 'journaled') THEN
    RAISE EXCEPTION 'Submission payload snapshot is frozen after draft' USING ERRCODE = '23514';
  END IF;
  -- Preserve the freeze through rejected-attempt resets and metadata replacement.
  IF frozen THEN
    NEW.payload_snapshot_frozen := true;
  ELSE
    NEW.payload_snapshot_frozen := false;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER certification_submissions_payload_snapshot_frozen
BEFORE UPDATE ON certification_submissions
FOR EACH ROW EXECUTE FUNCTION refuse_frozen_submission_payload_update();
