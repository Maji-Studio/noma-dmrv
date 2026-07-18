import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

/**
 * COALESCE(SUM(expr), 0), optionally FILTERed, coerced to number by construction.
 * Postgres returns numeric/bigint aggregates as text; `.mapWith(Number)` coerces
 * at the driver boundary (#402).
 */
export function sumNumeric(
  expr: SQLWrapper,
  filter?: SQLWrapper,
): SQL<number> {
  return filter
    ? sql<number>`COALESCE(SUM(${expr}) FILTER (WHERE ${filter}), 0)`.mapWith(
        Number,
      )
    : sql<number>`COALESCE(SUM(${expr}), 0)`.mapWith(Number);
}

/**
 * count(*), optionally FILTERed, coerced to number by construction.
 * Postgres returns numeric/bigint aggregates as text; `.mapWith(Number)` coerces
 * at the driver boundary (#402).
 */
export function countRows(filter?: SQLWrapper): SQL<number> {
  return filter
    ? sql<number>`count(*) filter (where ${filter})`.mapWith(Number)
    : sql<number>`count(*)`.mapWith(Number);
}

/**
 * Coerce an arbitrary already-built numeric-aggregate SQL fragment to number by
 * construction. Postgres returns numeric/bigint aggregates as text;
 * `.mapWith(Number)` coerces at the driver boundary (#402). Use for complex
 * aggregates that don't fit sumNumeric/countRows (multiplier SUMs, re-wraps of
 * subquery aggregate columns).
 */
export function numericAggregate(fragment: SQL<number>): SQL<number> {
  return fragment.mapWith(Number);
}
