-- Constraint-repair: deduplicate any pre-existing duplicate blend-material
-- lines before enforcing uniqueness, keeping the earliest line per
-- (formulation_id, feedstock_type_id) — lowest sort_order, then oldest, then
-- lowest id. No production data exists yet; this guards the seeded migration
-- gate and any shared database from a hard ADD CONSTRAINT failure.
DELETE FROM "formulation_ingredients" a
USING "formulation_ingredients" b
WHERE a."formulation_id" = b."formulation_id"
  AND a."feedstock_type_id" = b."feedstock_type_id"
  AND (
    a."sort_order" > b."sort_order"
    OR (a."sort_order" = b."sort_order" AND a."created_at" > b."created_at")
    OR (a."sort_order" = b."sort_order" AND a."created_at" = b."created_at" AND a."id" > b."id")
  );--> statement-breakpoint
ALTER TABLE "formulation_ingredients" ADD CONSTRAINT "formulation_ingredients_formulation_feedstock_unique" UNIQUE("formulation_id","feedstock_type_id");