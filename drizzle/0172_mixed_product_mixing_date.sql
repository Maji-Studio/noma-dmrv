-- Same rule as deriveBiocharProductProductionDate: composition ingredients
-- are non-biochar blend inputs; zero-mass recipe lines were not used.
-- Pure products retain their source-run day, including water-only additions.
UPDATE biochar_products AS product
SET production_date = (product.placed_at AT TIME ZONE facility.timezone)::date,
    version = product.version + 1,
    updated_at = CURRENT_TIMESTAMP
FROM facilities AS facility
WHERE facility.id = product.facility_id
  AND facility.organization_id = product.organization_id
  AND product.production_date IS DISTINCT FROM
    (product.placed_at AT TIME ZONE facility.timezone)::date
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(product.composition->'ingredients') = 'array'
        THEN product.composition->'ingredients' ELSE '[]'::jsonb END
    ) AS ingredient
    WHERE CASE WHEN jsonb_typeof(ingredient->'massKg') = 'number'
      THEN (ingredient->>'massKg')::numeric > 0 ELSE false END
  );
