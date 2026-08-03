import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

/**
 * Source-biochar mass for persisted product rows.
 *
 * `massKg` is the total pre-water blend mass. Ingredient `massKg` values are
 * the recorded material inputs. Formulation ratios are volume shares and are
 * deliberately absent from this expression.
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
