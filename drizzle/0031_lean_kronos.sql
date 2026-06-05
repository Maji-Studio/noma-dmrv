ALTER TABLE "biochar_products" ALTER COLUMN "formulation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_batches" ALTER COLUMN "certifier" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "credit_batches" ALTER COLUMN "certifier" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "storage_locations" ADD COLUMN "formulation_id" uuid;--> statement-breakpoint
UPDATE "storage_locations"
SET "formulation_id" = "products"."formulation_id"
FROM (
  SELECT DISTINCT ON ("storage_location_id")
    "storage_location_id",
    "formulation_id"
  FROM "biochar_products"
  WHERE "storage_location_id" IS NOT NULL
  ORDER BY "storage_location_id", "created_at" DESC, "id" DESC
) AS "products"
WHERE "storage_locations"."id" = "products"."storage_location_id"
  AND "storage_locations"."type" = 'product_bin'
  AND "products"."formulation_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "storage_locations"
ADD CONSTRAINT "storage_locations_formulation_product_bin_only"
CHECK ("type" = 'product_bin' OR "formulation_id" IS NULL);
