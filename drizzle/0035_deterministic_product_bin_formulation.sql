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
  AND "products"."formulation_id" IS NOT NULL;
