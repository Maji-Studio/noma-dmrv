-- Reconcile the formulation/feedstock-type unification on databases that applied
-- the ORIGINAL 0047 before it was rewritten in place.
--
-- 0047 was edited under its existing journal tag: the version on `main` only adds
-- formulation_ingredients.feedstock_type_id (+ FK, drops ingredient_type/name),
-- while the rewritten version also (a) swaps the feedstock_types unique key from
-- (name) to (name, usage), (b) backfills storage_locations.feedstock_type_id, and
-- (c) rewrites biochar_products.composition ingredients to the feedstock_type_id
-- shape the app at HEAD reads. drizzle-kit migrate tracks by journal tag, not file
-- content, so any DB that already ran the old 0047 SILENTLY SKIPS the rewrite and
-- ends up missing (a)-(c). This migration applies that delta.
--
-- It is intentionally idempotent / guarded so it is a safe no-op on a database
-- that already has the final shape (e.g. a fresh `db:reset` where the rewritten
-- 0047 ran in full). It only references columns that the old 0047 already created,
-- so it never touches the dropped ingredient_type/name columns.

-- (a) Swap the feedstock_types unique key: (name) -> (name, usage).
ALTER TABLE "feedstock_types" DROP CONSTRAINT IF EXISTS "feedstock_types_name_unique";--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'feedstock_types_name_usage_unique'
  ) THEN
    ALTER TABLE "feedstock_types"
      ADD CONSTRAINT "feedstock_types_name_usage_unique" UNIQUE("name", "usage");
  END IF;
END $$;--> statement-breakpoint

-- (b) Backfill storage_locations.feedstock_type_id from each bin's composition
-- ingredients, but only for untyped feedstock bins that map to exactly one type.
-- Guarded by feedstock_type_id IS NULL, so re-running is a no-op.
WITH "composition_bins" AS (
  SELECT DISTINCT
    CASE
      WHEN "ingredient"->>'storageLocationId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN ("ingredient"->>'storageLocationId')::uuid
      ELSE NULL
    END AS "storage_location_id",
    "fi"."feedstock_type_id"
  FROM "biochar_products" AS "bp"
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof("bp"."composition"->'ingredients') = 'array'
      THEN "bp"."composition"->'ingredients'
      ELSE '[]'::jsonb
    END
  ) AS "elements"("ingredient")
  INNER JOIN "formulation_ingredients" AS "fi"
    ON "fi"."id" = CASE
      WHEN "ingredient"->>'formulationIngredientId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN ("ingredient"->>'formulationIngredientId')::uuid
      ELSE NULL
    END
  WHERE "ingredient" ? 'storageLocationId'
),
"unambiguous_bins" AS (
  SELECT
    "storage_location_id",
    MIN("feedstock_type_id"::text)::uuid AS "feedstock_type_id"
  FROM "composition_bins"
  WHERE "storage_location_id" IS NOT NULL
  GROUP BY "storage_location_id"
  HAVING COUNT(DISTINCT "feedstock_type_id") = 1
)
UPDATE "storage_locations" AS "sl"
SET "feedstock_type_id" = "unambiguous_bins"."feedstock_type_id"
FROM "unambiguous_bins"
WHERE "sl"."id" = "unambiguous_bins"."storage_location_id"
  AND "sl"."type" = 'feedstock_bin'
  AND "sl"."feedstock_type_id" IS NULL;--> statement-breakpoint

-- Fail safe: abort (rolling back the whole migration) if any composition bin
-- still cannot be mapped to a single blend feedstock type after the backfill.
DO $$
BEGIN
  IF EXISTS (
    WITH "composition_bins" AS (
      SELECT DISTINCT
        CASE
          WHEN "ingredient"->>'storageLocationId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          THEN ("ingredient"->>'storageLocationId')::uuid
          ELSE NULL
        END AS "storage_location_id",
        "fi"."feedstock_type_id"
      FROM "biochar_products" AS "bp"
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE
          WHEN jsonb_typeof("bp"."composition"->'ingredients') = 'array'
          THEN "bp"."composition"->'ingredients'
          ELSE '[]'::jsonb
        END
      ) AS "elements"("ingredient")
      INNER JOIN "formulation_ingredients" AS "fi"
        ON "fi"."id" = CASE
          WHEN "ingredient"->>'formulationIngredientId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          THEN ("ingredient"->>'formulationIngredientId')::uuid
          ELSE NULL
        END
      WHERE "ingredient" ? 'storageLocationId'
    )
    SELECT 1
    FROM "composition_bins" AS "cb"
    INNER JOIN "storage_locations" AS "sl"
      ON "sl"."id" = "cb"."storage_location_id"
    WHERE "sl"."type" = 'feedstock_bin'
      AND (
        "sl"."feedstock_type_id" IS NULL
        OR "sl"."feedstock_type_id" <> "cb"."feedstock_type_id"
      )
  ) THEN
    RAISE EXCEPTION 'Could not map all legacy composition ingredient bins to blend feedstock types';
  END IF;
END $$;--> statement-breakpoint

-- (c) Rewrite biochar_products.composition ingredients to the feedstock_type_id
-- shape. Only touches rows that still carry a legacy ingredient (ingredientName /
-- ingredientType present, or feedstockTypeId missing), so it is a no-op once the
-- data is already migrated.
UPDATE "biochar_products" AS "bp"
SET "composition" = jsonb_set(
  "bp"."composition",
  '{ingredients}',
  COALESCE(
    (
      SELECT jsonb_agg(
        CASE
          WHEN "ft"."id" IS NULL THEN "ingredient"
          ELSE ("ingredient" - 'ingredientName' - 'ingredientType')
            || jsonb_build_object(
              'feedstockTypeId', "ft"."id"::text,
              'feedstockTypeName', "ft"."name",
              'feedstockTypeCategory', "ft"."category"
            )
        END
        ORDER BY "ordinality"
      )
      FROM jsonb_array_elements(
        CASE
          WHEN jsonb_typeof("bp"."composition"->'ingredients') = 'array'
          THEN "bp"."composition"->'ingredients'
          ELSE '[]'::jsonb
        END
      ) WITH ORDINALITY AS "elements"("ingredient", "ordinality")
      LEFT JOIN "formulation_ingredients" AS "fi"
        ON "fi"."id" = CASE
          WHEN "ingredient"->>'formulationIngredientId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          THEN ("ingredient"->>'formulationIngredientId')::uuid
          ELSE NULL
        END
      LEFT JOIN "feedstock_types" AS "ft"
        ON "ft"."id" = "fi"."feedstock_type_id"
    ),
    '[]'::jsonb
  )
)
WHERE jsonb_typeof("bp"."composition"->'ingredients') = 'array'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements("bp"."composition"->'ingredients') AS "elements"("ingredient")
    WHERE ("ingredient" ? 'ingredientName')
      OR ("ingredient" ? 'ingredientType')
      OR NOT ("ingredient" ? 'feedstockTypeId')
  );
