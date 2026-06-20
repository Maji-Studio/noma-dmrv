-- ADR 0017 — close the Method-B baseline invariant around the evidence tables.
--
-- Migration 0060 enforced the >=30 pre-unlock Method-A sample floor only when a
-- production_processes row was inserted or updated. That left direct or app-layer
-- writes to samples / credit_batches able to lower an already-unlocked process
-- below its baseline without touching the process row. These companion triggers
-- re-check the affected process ids after sample deletes/repoints/time changes
-- and credit-batch process reassignments/deletes.

CREATE OR REPLACE FUNCTION assert_existing_process_method_b_minimum_samples(process_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  process_row record;
  prior_sample_count integer;
BEGIN
  IF process_id IS NULL THEN
    RETURN;
  END IF;

  SELECT id, sampling_method, method_b_unlocked_at
    INTO process_row
    FROM production_processes
   WHERE id = process_id;

  IF NOT FOUND OR process_row.sampling_method <> 'method_b' THEN
    RETURN;
  END IF;

  SELECT count(*)
    INTO prior_sample_count
    FROM samples s
    JOIN credit_batches cb ON cb.id = s.credit_batch_id
   WHERE cb.production_process_id = process_row.id
     AND s.sampling_time < process_row.method_b_unlocked_at;

  IF prior_sample_count < 30 THEN
    RAISE EXCEPTION
      'Production process % cannot use Method B: requires >= 30 prior Method A samples, found % (Biochar Protocol §8.3.1 G-F74T-0; ADR 0017).',
      process_row.id, prior_sample_count
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_method_b_minimum_samples_after_sample_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_process_id uuid;
  new_process_id uuid;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.credit_batch_id IS NOT NULL THEN
    SELECT production_process_id
      INTO old_process_id
      FROM credit_batches
     WHERE id = OLD.credit_batch_id;
    PERFORM assert_existing_process_method_b_minimum_samples(old_process_id);
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.credit_batch_id IS NOT NULL THEN
    SELECT production_process_id
      INTO new_process_id
      FROM credit_batches
     WHERE id = NEW.credit_batch_id;
    IF new_process_id IS DISTINCT FROM old_process_id THEN
      PERFORM assert_existing_process_method_b_minimum_samples(new_process_id);
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS samples_method_b_minimum_samples ON samples;
--> statement-breakpoint
CREATE TRIGGER samples_method_b_minimum_samples
  AFTER INSERT OR UPDATE OF credit_batch_id, sampling_time OR DELETE ON samples
  FOR EACH ROW
  EXECUTE FUNCTION enforce_method_b_minimum_samples_after_sample_write();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_method_b_minimum_samples_after_credit_batch_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM assert_existing_process_method_b_minimum_samples(OLD.production_process_id);
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM assert_existing_process_method_b_minimum_samples(NEW.production_process_id);
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.production_process_id IS DISTINCT FROM OLD.production_process_id THEN
      PERFORM assert_existing_process_method_b_minimum_samples(NEW.production_process_id);
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS credit_batches_method_b_minimum_samples ON credit_batches;
--> statement-breakpoint
CREATE TRIGGER credit_batches_method_b_minimum_samples
  AFTER INSERT OR UPDATE OF production_process_id OR DELETE ON credit_batches
  FOR EACH ROW
  EXECUTE FUNCTION enforce_method_b_minimum_samples_after_credit_batch_write();
