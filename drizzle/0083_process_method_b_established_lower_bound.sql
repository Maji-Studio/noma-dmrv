-- ADR 0017 (2026-07-12 process-start amendment) — add the baseline window's
-- LOWER bound to the Method-B DB backstop. Supersedes the function body from
-- migration 0060 (`enforce_process_method_b_minimum_samples`); the trigger
-- itself is unchanged.
--
-- The ≥30 Method-A baseline counts samples in `[established_at,
-- method_b_unlocked_at)`. Migration 0060 enforced only the upper bound, so a
-- back-entered process could satisfy the floor with samples dated BEFORE its
-- operational start — samples the protocol says never qualify ("samples dated
-- before its operational start never count toward the ≥30-sample Method-A
-- baseline", ADR 0017; CONTEXT.md "Method-B baseline"). This closes that
-- over-crediting hole at the DB layer, mirroring the app counter
-- (`countEligibleSamplesByProcess`), which applies the same two bounds.
--
-- `established_at` is NOT NULL (schema default now()), so the predicate stays
-- fail-closed exactly as before: the only NULL remains `method_b_unlocked_at`,
-- which yields a 0 count and blocks the flip.

CREATE OR REPLACE FUNCTION enforce_process_method_b_minimum_samples()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  prior_sample_count integer;
BEGIN
  IF NEW.sampling_method = 'method_b' THEN
    -- Baseline window is [established_at, method_b_unlocked_at): samples before
    -- the operational start never qualify; post-unlock Method-B samples are not
    -- baseline evidence. A null unlock timestamp yields 0 (fail closed).
    SELECT count(*)
      INTO prior_sample_count
      FROM samples s
      JOIN credit_batches cb ON cb.id = s.credit_batch_id
     WHERE cb.production_process_id = NEW.id
       AND s.sampling_time >= NEW.established_at
       AND s.sampling_time < NEW.method_b_unlocked_at;

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
