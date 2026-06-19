-- P0-06 — DB-layer guardrail for 200-year durability evidence completeness at
-- issuance (defense-in-depth).
--
-- Protocol: Biochar Storage in Soil Environments Module v1.2 §5.1.1.3.1 — the
-- 200-year durability fraction F_durable,200 depends on a soil temperature whose
-- value (`soil_temperature_c`) and provenance (`soil_temperature_source`:
-- baseline | global_database) must be recorded on every application before its
-- credits can be verified/issued. Removal submission already fail-closes on
-- incomplete durability evidence app-side, but credit-batch status reaches
-- 'verified'/'issued' via the registry/certification sync path (not through
-- `updateCreditBatch`, which never sets `status`). This trigger enforces the
-- invariant at the DB layer regardless of which code path — or direct SQL —
-- performs the transition.
--
-- Scope: applies ONLY to durability_option = '200_year' batches (1000-year
-- durability uses reflectance, not soil temperature). The "linked applications"
-- are those joined through credit_batch_applications. Batches with zero linked
-- applications are out of scope here (a batch with nothing to credit is gated
-- elsewhere); this guardrail asserts that whatever IS linked carries the
-- required evidence.

-- (1) Transition gate: block a 200-year batch entering verified/issued while any
--     linked application lacks soil-temperature value + source. Fires on INSERT
--     and UPDATE (any column); the cheap status/durability predicate short-
--     circuits before the join, and once verified/issued the linked
--     applications are immutable app-side, so re-checks on later edits are
--     no-ops.
CREATE OR REPLACE FUNCTION enforce_credit_batch_durability_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  incomplete_count integer;
  incomplete_codes text;
BEGIN
  IF NEW.durability_option = '200_year'
     AND NEW.status IN ('verified', 'issued') THEN

    SELECT count(*),
           string_agg(a.code, ', ' ORDER BY a.code)
      INTO incomplete_count, incomplete_codes
      FROM credit_batch_applications cba
      JOIN applications a ON a.id = cba.application_id
     WHERE cba.credit_batch_id = NEW.id
       AND (a.soil_temperature_c IS NULL OR a.soil_temperature_source IS NULL);

    IF incomplete_count > 0 THEN
      RAISE EXCEPTION
        'Credit batch % cannot move to status %: % linked 200-year application(s) missing soil-temperature evidence (value + source): % (Soil Storage Module §5.1.1.3.1; P0-06).',
        NEW.code, NEW.status, incomplete_count, incomplete_codes
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS credit_batch_durability_evidence ON credit_batches;
--> statement-breakpoint
CREATE TRIGGER credit_batch_durability_evidence
  BEFORE INSERT OR UPDATE ON credit_batches
  FOR EACH ROW
  EXECUTE FUNCTION enforce_credit_batch_durability_evidence();
--> statement-breakpoint
-- (2) Back-door guard: closing (1)'s only bypass — linking (or re-pointing) an
--     application into a batch that is ALREADY verified/issued and 200-year must
--     not introduce incomplete evidence. Without this, an evidence-incomplete
--     application could be attached AFTER the batch was verified, leaving the
--     invariant violated even though (1) passed at transition time.
CREATE OR REPLACE FUNCTION enforce_durability_evidence_on_batch_link()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  rec record;
BEGIN
  SELECT cb.code AS batch_code,
         cb.status::text AS batch_status,
         cb.durability_option::text AS durability_option,
         a.code AS app_code,
         a.soil_temperature_c AS temp_c,
         a.soil_temperature_source AS temp_source
    INTO rec
    FROM credit_batches cb
    JOIN applications a ON a.id = NEW.application_id
   WHERE cb.id = NEW.credit_batch_id;

  IF rec.durability_option = '200_year'
     AND rec.batch_status IN ('verified', 'issued')
     AND (rec.temp_c IS NULL OR rec.temp_source IS NULL) THEN
    RAISE EXCEPTION
      'Cannot link application % to %-status credit batch %: 200-year applications require soil-temperature evidence (value + source) before issuance (Soil Storage Module §5.1.1.3.1; P0-06).',
      rec.app_code, rec.batch_status, rec.batch_code
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS credit_batch_application_durability_evidence ON credit_batch_applications;
--> statement-breakpoint
CREATE TRIGGER credit_batch_application_durability_evidence
  BEFORE INSERT OR UPDATE ON credit_batch_applications
  FOR EACH ROW
  EXECUTE FUNCTION enforce_durability_evidence_on_batch_link();
