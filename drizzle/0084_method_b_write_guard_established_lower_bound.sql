-- ADR 0017 (2026-07-12 process-start amendment) — extend the baseline window's
-- LOWER bound to the sample/credit-batch WRITE-PATH backstop.
--
-- Migration 0083 added `sampling_time >= established_at` to the process-row
-- trigger (`enforce_process_method_b_minimum_samples`), but its 0062 companion
-- `assert_existing_process_method_b_minimum_samples` — invoked by the AFTER
-- triggers on `samples` and `credit_batches` — still counted only
-- `sampling_time < method_b_unlocked_at`, with no lower bound. That left the
-- over-crediting hole open on the write paths: pre-establishment, back-dated
-- samples could hold the count >= 30 while every valid in-window row was deleted
-- or re-dated, so an already-Method-B process silently kept an invalid baseline.
--
-- This mirrors 0083 on the companion: select `established_at` into the process
-- row and require `s.sampling_time >= process_row.established_at`. `established_at`
-- is NOT NULL (schema default now()), so the predicate stays fail-closed exactly
-- as before; only `method_b_unlocked_at` can be NULL, which yields a 0 count and
-- blocks the write. The AFTER triggers themselves are unchanged.

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

  SELECT id, sampling_method, method_b_unlocked_at, established_at
    INTO process_row
    FROM production_processes
   WHERE id = process_id;

  IF NOT FOUND OR process_row.sampling_method <> 'method_b' THEN
    RETURN;
  END IF;

  -- Baseline window is [established_at, method_b_unlocked_at): samples before the
  -- operational start never qualify; post-unlock Method-B samples are not
  -- baseline evidence. A null unlock timestamp yields 0 (fail closed).
  SELECT count(*)
    INTO prior_sample_count
    FROM samples s
    JOIN credit_batches cb ON cb.id = s.credit_batch_id
   WHERE cb.production_process_id = process_row.id
     AND s.sampling_time >= process_row.established_at
     AND s.sampling_time < process_row.method_b_unlocked_at;

  IF prior_sample_count < 30 THEN
    RAISE EXCEPTION
      'Production process % cannot use Method B: requires >= 30 prior Method A samples, found % (Biochar Protocol §8.3.1 G-F74T-0; ADR 0017).',
      process_row.id, prior_sample_count
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;
