ALTER TABLE "applications" ADD CONSTRAINT "applications_soil_temperature_c_range" CHECK ("applications"."soil_temperature_c" is null or ("applications"."soil_temperature_c" >= -50 and "applications"."soil_temperature_c" <= 60));
--> statement-breakpoint
-- P0-06 follow-ups (PR #279 review) — durability-evidence hardening.
--
-- (1) Retention guard: migration 0053 blocks credit-batch verified/issued
--     transitions and credit_batch_applications links while linked 200-year
--     applications lack soil-temperature evidence, but it does NOT cover UPDATES
--     to an already-linked `applications` row. `updateApplication` (and direct
--     SQL) can still null `soil_temperature_c` / `soil_temperature_source` AFTER
--     a batch is verified/issued, silently clearing the evidence behind an issued
--     credit. This trigger closes that hole: an application linked to a
--     verified/issued 200-year batch may not have its soil-temperature evidence
--     cleared (Soil Storage Module §5.1.1.3.1).
CREATE OR REPLACE FUNCTION enforce_application_durability_evidence_retained()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  linked_batch_code text;
BEGIN
  -- Only act when the update would leave the evidence incomplete.
  IF NEW.soil_temperature_c IS NULL OR NEW.soil_temperature_source IS NULL THEN
    SELECT cb.code
      INTO linked_batch_code
      FROM credit_batch_applications cba
      JOIN credit_batches cb ON cb.id = cba.credit_batch_id
     WHERE cba.application_id = NEW.id
       AND cb.durability_option = '200_year'
       AND cb.status IN ('verified', 'issued')
     LIMIT 1;

    IF linked_batch_code IS NOT NULL THEN
      RAISE EXCEPTION
        'Application % is linked to verified/issued 200-year credit batch %: its soil-temperature evidence (value + source) cannot be cleared (Soil Storage Module §5.1.1.3.1; P0-06).',
        NEW.code, linked_batch_code
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS application_durability_evidence_retained ON applications;
--> statement-breakpoint
CREATE TRIGGER application_durability_evidence_retained
  BEFORE UPDATE OF soil_temperature_c, soil_temperature_source ON applications
  FOR EACH ROW
  EXECUTE FUNCTION enforce_application_durability_evidence_retained();
--> statement-breakpoint
-- (2) Mirror the app's UTC cutoff in the Method B baseline guard (0052). The app
--     passes `new Date().toISOString()` (UTC) into `getMethodBEligibilityByReactor`,
--     which coerces to the UTC calendar date; `CURRENT_DATE` resolves in the DB
--     session time zone and can diverge from UTC around midnight at the 30-sample
--     boundary. Re-declare the function so the DB backstop matches the app's UTC
--     contract exactly (supersedes 0052's definition; trigger binding unchanged).
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
       AND pr.date < (now() AT TIME ZONE 'UTC')::date;

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