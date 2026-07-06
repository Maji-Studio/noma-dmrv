-- ADR 0021 — durability tier is facility-scoped. The `credit_batches.durability_option`
-- column was dropped in 0069; the three P0-06 durability-evidence trigger functions
-- (0053, 0054) still read it and now fail at runtime ("column durability_option does
-- not exist"). Re-declare each to derive the tier from the batch's FACILITY
-- (`facilities.durability_option`) via a join. Trigger bindings are unchanged.
--
-- Hand-written (db:generate cannot emit trigger/function bodies). The schema
-- snapshot is unchanged from 0069 (functions/triggers are not tracked by drizzle).

-- (1) Transition gate on credit_batches — tier now read from the batch's facility.
CREATE OR REPLACE FUNCTION enforce_credit_batch_durability_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  incomplete_count integer;
  incomplete_codes text;
  batch_tier text;
BEGIN
  IF NEW.status IN ('verified', 'issued') THEN
    SELECT f.durability_option::text
      INTO batch_tier
      FROM facilities f
     WHERE f.id = NEW.facility_id;

    IF batch_tier = '200_year' THEN
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
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
-- (2) Back-door guard on credit_batch_applications — join facilities for the tier.
CREATE OR REPLACE FUNCTION enforce_durability_evidence_on_batch_link()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  rec record;
BEGIN
  SELECT cb.code AS batch_code,
         cb.status::text AS batch_status,
         f.durability_option::text AS durability_option,
         a.code AS app_code,
         a.soil_temperature_c AS temp_c,
         a.soil_temperature_source AS temp_source
    INTO rec
    FROM credit_batches cb
    JOIN facilities f ON f.id = cb.facility_id
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
-- (3) Retention guard on applications — join facilities for the tier.
CREATE OR REPLACE FUNCTION enforce_application_durability_evidence_retained()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  linked_batch_code text;
BEGIN
  IF NEW.soil_temperature_c IS NULL OR NEW.soil_temperature_source IS NULL THEN
    SELECT cb.code
      INTO linked_batch_code
      FROM credit_batch_applications cba
      JOIN credit_batches cb ON cb.id = cba.credit_batch_id
      JOIN facilities f ON f.id = cb.facility_id
     WHERE cba.application_id = NEW.id
       AND f.durability_option = '200_year'
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
