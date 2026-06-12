CREATE TYPE "public"."feedstock_type_usage" AS ENUM('pyrolysis', 'blend');--> statement-breakpoint
ALTER TABLE "feedstock_types" ADD COLUMN "usage" "feedstock_type_usage" DEFAULT 'pyrolysis' NOT NULL;--> statement-breakpoint
UPDATE "storage_locations" AS "sl"
SET "feedstock_type_id" = "inferred"."feedstock_type_id"
FROM (
  SELECT
    "storage_location_id",
    (ARRAY_AGG(DISTINCT "feedstock_type_id"))[1] AS "feedstock_type_id"
  FROM "feedstocks"
  WHERE "storage_location_id" IS NOT NULL
  GROUP BY "storage_location_id"
  HAVING COUNT(DISTINCT "feedstock_type_id") = 1
) AS "inferred"
WHERE "sl"."id" = "inferred"."storage_location_id"
  AND "sl"."type" IN ('feedstock_bin', 'ingredient_bin')
  AND "sl"."feedstock_type_id" IS NULL;--> statement-breakpoint
UPDATE "feedstock_types"
SET "usage" = 'blend'
WHERE "category" = 'ingredient'
   OR "id" IN (
    SELECT DISTINCT "feedstock_type_id"
    FROM "storage_locations"
    WHERE "type" = 'ingredient_bin'
      AND "feedstock_type_id" IS NOT NULL
   );--> statement-breakpoint
ALTER TABLE "storage_locations" DROP CONSTRAINT "storage_locations_formulation_product_bin_only";--> statement-breakpoint
ALTER TABLE "storage_locations" ALTER COLUMN "type" SET DATA TYPE text USING "type"::text;--> statement-breakpoint
UPDATE "storage_locations" SET "type" = 'feedstock_bin' WHERE "type" = 'ingredient_bin';--> statement-breakpoint
DROP TYPE "public"."storage_location_type";--> statement-breakpoint
CREATE TYPE "public"."storage_location_type" AS ENUM('feedstock_bin', 'biochar_bin', 'product_bin');--> statement-breakpoint
ALTER TABLE "storage_locations" ALTER COLUMN "type" SET DATA TYPE "public"."storage_location_type" USING "type"::"public"."storage_location_type";--> statement-breakpoint
ALTER TABLE "storage_locations" ADD CONSTRAINT "storage_locations_formulation_product_bin_only" CHECK ("storage_locations"."type" = 'product_bin' or "storage_locations"."formulation_id" is null);
