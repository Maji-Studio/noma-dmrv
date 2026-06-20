-- ADR 0017 — DB-layer backstop for the Method B unlock, re-grained to the
-- PRODUCTION PROCESS (defense-in-depth). Replaces the dropped reactor trigger
-- `enforce_reactor_method_b_minimum_samples` (migration 0052, dropped in 0057
-- when `sampling_method` moved off `reactors`).
--
-- Protocol: Biochar Protocol §8.3.1 (`G-F74T-0`) — a production process may only
-- switch to Method B (sample ≥ 1-in-10 production batches) AFTER it has
-- accumulated its ≥ 30-sample Method A baseline. The app already enforces this
-- in `unlockMethodBForProcess` (src/data-access/production-processes.ts), but
-- that server-action guard can be bypassed by direct SQL. This trigger closes
-- that hole so the invariant holds at the DB layer.
--
-- Semantics mirror the app's lifetime baseline counter EXACTLY
-- (`getMethodBEligibilityByProcess`): credit-batch-linked Samples whose credit
-- batch belongs to this process. In-process samples (null `credit_batch_id`) are
-- internal-only (ADR 0016) and the join drops them. There is NO `as_of` bound at
-- unlock — the lifetime count since `established_at` is the whole-life population
-- (a feedstock/condition change opens a NEW process row whose baseline restarts
-- from zero, so prior processes' samples never leak in).
--
-- Fires on INSERT and on UPDATE (any column), evaluating only when the RESULTING
-- sampling_method is 'method_b'. This matches the app's "re-validate on every
-- save" stance: a sample deletion can regress an already-Method-B process's
-- eligibility, so an unrelated edit must re-assert the invariant rather than
-- silently preserve a now-invalid configuration.
--
-- The 30-sample threshold is the protocol HARD FLOOR (METHOD_B_MINIMUM_METHOD_A_SAMPLES,
-- src/config/certification.ts). The app's `agreed_baseline_size` is the
-- Isometric-negotiated number (≥ 30); since it is always ≥ 30, this DB floor is
-- never stricter than the app gate. The constant is inlined because a Postgres
-- function cannot import the TS constant; if that constant changes, this
-- migration must be superseded by a new one (never edit an applied migration).

CREATE OR REPLACE FUNCTION enforce_process_method_b_minimum_samples()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  prior_sample_count integer;
BEGIN
  IF NEW.sampling_method = 'method_b' THEN
    SELECT count(*)
      INTO prior_sample_count
      FROM samples s
      JOIN credit_batches cb ON cb.id = s.credit_batch_id
     WHERE cb.production_process_id = NEW.id;

    IF prior_sample_count < 30 THEN
      RAISE EXCEPTION
        'Production process % cannot use Method B: requires >= 30 prior Method A samples, found % (Biochar Protocol §8.3.1 G-F74T-0; ADR 0017).',
        NEW.id, prior_sample_count
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS process_method_b_minimum_samples ON production_processes;
--> statement-breakpoint
CREATE TRIGGER process_method_b_minimum_samples
  BEFORE INSERT OR UPDATE ON production_processes
  FOR EACH ROW
  EXECUTE FUNCTION enforce_process_method_b_minimum_samples();
