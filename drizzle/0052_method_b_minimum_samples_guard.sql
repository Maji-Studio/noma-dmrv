-- P0-03 — DB-layer guardrail for the Method B sampling switch (defense-in-depth).
--
-- Protocol: Biochar Protocol 1.2 §8.3.1.2 — a reactor may only run on Method B
-- (sample >= 1-in-10 production batches) AFTER it has accumulated the 30-sample
-- Method A baseline. The app already enforces this on the server actions
-- (`getMethodBEligibilityByReactor` + `createReactor`/`updateReactor` in
-- src/data-access), but those checks can be bypassed by direct SQL. This trigger
-- closes that hole so the invariant holds at the DB layer.
--
-- Semantics mirror the app's count EXACTLY: samples attached to the reactor's
-- production runs whose run date precedes today. The app passes
-- `asOfDate = now()` and Drizzle compares it against the `date`-typed
-- `production_runs.date` column, which coerces to `pr.date < CURRENT_DATE`
-- (today's and future-dated runs are excluded — you cannot have sampled a run
-- that has not happened yet). The trigger uses the same comparison so the DB
-- backstop is never stricter than the app gate.
--
-- Fires on INSERT and on UPDATE (any column), evaluating only when the RESULTING
-- sampling_method is 'method_b'. This matches the app's "re-validate on every
-- save" stance: sample deletions can regress an already-Method-B reactor's
-- eligibility, so an unrelated edit must re-assert the invariant rather than
-- silently preserve a now-invalid configuration.
--
-- The 30-sample threshold is the protocol baseline (METHOD_B_MINIMUM_METHOD_A_SAMPLES,
-- src/config/certification.ts). It is inlined here because a Postgres function
-- cannot import the TS constant; if that constant changes, this migration must be
-- superseded by a new one (never edit an applied migration).

CREATE OR REPLACE FUNCTION enforce_reactor_method_b_minimum_samples()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  prior_sample_count integer;
BEGIN
  IF NEW.sampling_method = 'method_b' THEN
    SELECT count(s.id)
      INTO prior_sample_count
      FROM production_runs pr
      LEFT JOIN samples s ON s.production_run_id = pr.id
     WHERE pr.reactor_id = NEW.id
       AND pr.date < CURRENT_DATE;

    IF prior_sample_count < 30 THEN
      RAISE EXCEPTION
        'Reactor % cannot use Method B: requires >= 30 prior Method A samples, found % (Biochar Protocol 1.2 §8.3.1.2; P0-03).',
        NEW.code, prior_sample_count
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS reactor_method_b_minimum_samples ON reactors;
--> statement-breakpoint
CREATE TRIGGER reactor_method_b_minimum_samples
  BEFORE INSERT OR UPDATE ON reactors
  FOR EACH ROW
  EXECUTE FUNCTION enforce_reactor_method_b_minimum_samples();
