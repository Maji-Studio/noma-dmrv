import { sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { biocharProductSourceAllocations } from "@/db/schema";

/** Persisted product wet mass: pre-water blend mass plus separately added water. */
export function productWetMassKgSql(
  blendMassKg: SQLWrapper,
  waterAddedKg: SQLWrapper,
): SQL<number> {
  return sql<number>`COALESCE(${blendMassKg}, 0) + COALESCE(${waterAddedKg}, 0)`;
}

/**
 * Source-biochar mass for persisted product rows.
 *
 * `massKg` is the total pre-water wet blend mass. Ingredient `massKg` values
 * are the recorded wet/as-received material inputs. Their server-derived dry
 * snapshots are feedstock-inventory facts and deliberately absent here.
 */
export function sourceBiocharMassKgSql(
  blendMassKg: SQLWrapper,
  composition: SQLWrapper,
): SQL<number> {
  return sql<number>`
    GREATEST(
      COALESCE(${blendMassKg}, 0) - COALESCE((
        SELECT SUM((ingredient.value ->> 'massKg')::numeric)
        FROM jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(${composition} -> 'ingredients') = 'array'
            THEN ${composition} -> 'ingredients'
            ELSE '[]'::jsonb
          END
        ) AS ingredient(value)
        WHERE jsonb_typeof(ingredient.value -> 'massKg') = 'number'
          AND (ingredient.value ->> 'massKg')::numeric > 0
      ), 0),
      0::numeric
    )
  `;
}

/** SQL twin of `resolveProductDryBiocharKg` for persisted product queries. */
export function productDryBiocharKgSql(
  productId: SQLWrapper,
  blendMassKg: SQLWrapper,
  moistureContentPercent: SQLWrapper,
  composition: SQLWrapper,
  organizationId: string,
): SQL<number | null> {
  return sql<number | null>`
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM ${biocharProductSourceAllocations} allocation
        WHERE allocation.biochar_product_id = ${productId}
          AND allocation.organization_id = ${organizationId}
      ) THEN COALESCE((
        SELECT SUM(allocation.allocated_dry_mass_kg)
        FROM ${biocharProductSourceAllocations} allocation
        WHERE allocation.biochar_product_id = ${productId}
          AND allocation.organization_id = ${organizationId}
      ), 0)
      WHEN ${blendMassKg} IS NULL OR ${moistureContentPercent} IS NULL
        THEN NULL
      ELSE ${sourceBiocharMassKgSql(blendMassKg, composition)}
        * (1 - (${moistureContentPercent} / 100.0))
    END
  `;
}
