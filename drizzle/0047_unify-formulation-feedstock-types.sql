ALTER TABLE "formulation_ingredients" ADD COLUMN "feedstock_type_id" uuid;--> statement-breakpoint
ALTER TABLE "feedstock_types" DROP CONSTRAINT "feedstock_types_name_unique";--> statement-breakpoint
ALTER TABLE "feedstock_types" ADD CONSTRAINT "feedstock_types_name_usage_unique" UNIQUE("name","usage");--> statement-breakpoint
INSERT INTO "feedstock_types" ("code", "name", "category", "usage", "description")
SELECT DISTINCT
  'FT-BLEND-' || upper(substr(md5(lower("name") || ':' || "ingredient_type"::text), 1, 8)),
  "name",
  "ingredient_type"::text,
  'blend'::"feedstock_type_usage",
  'Migrated from formulation ingredient'
FROM "formulation_ingredients"
WHERE "feedstock_type_id" IS NULL
ON CONFLICT ("name", "usage") DO NOTHING;--> statement-breakpoint
UPDATE "formulation_ingredients"
SET "feedstock_type_id" = "feedstock_types"."id"
FROM "feedstock_types"
WHERE "feedstock_types"."name" = "formulation_ingredients"."name"
  AND "feedstock_types"."usage" = 'blend'::"feedstock_type_usage"
  AND "formulation_ingredients"."feedstock_type_id" IS NULL;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "formulation_ingredients"
    WHERE "feedstock_type_id" IS NULL
  ) THEN
    RAISE EXCEPTION 'Could not map all legacy formulation ingredients to blend feedstock types';
  END IF;
END $$;--> statement-breakpoint
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
WHERE jsonb_typeof("bp"."composition"->'ingredients') = 'array';--> statement-breakpoint
ALTER TABLE "formulation_ingredients" ALTER COLUMN "feedstock_type_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "formulation_ingredients" ADD CONSTRAINT "formulation_ingredients_feedstock_type_id_feedstock_types_id_fk" FOREIGN KEY ("feedstock_type_id") REFERENCES "public"."feedstock_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formulation_ingredients" DROP COLUMN "ingredient_type";--> statement-breakpoint
ALTER TABLE "formulation_ingredients" DROP COLUMN "name";--> statement-breakpoint
DROP TYPE "public"."ingredient_type";
