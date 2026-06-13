ALTER TABLE "formulation_ingredients" ADD COLUMN "feedstock_type_id" uuid;--> statement-breakpoint
INSERT INTO "feedstock_types" ("code", "name", "category", "usage", "description")
SELECT DISTINCT
  'FT-BLEND-' || upper(substr(md5(lower("name") || ':' || "ingredient_type"::text), 1, 8)),
  "name",
  "ingredient_type"::text,
  'blend'::"feedstock_type_usage",
  'Migrated from formulation ingredient'
FROM "formulation_ingredients"
WHERE "feedstock_type_id" IS NULL
ON CONFLICT ("name") DO NOTHING;--> statement-breakpoint
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
ALTER TABLE "formulation_ingredients" ALTER COLUMN "feedstock_type_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "formulation_ingredients" ADD CONSTRAINT "formulation_ingredients_feedstock_type_id_feedstock_types_id_fk" FOREIGN KEY ("feedstock_type_id") REFERENCES "public"."feedstock_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formulation_ingredients" DROP COLUMN "ingredient_type";--> statement-breakpoint
ALTER TABLE "formulation_ingredients" DROP COLUMN "name";--> statement-breakpoint
DROP TYPE "public"."ingredient_type";
