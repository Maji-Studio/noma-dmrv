import { sql, type SQL } from "drizzle-orm";
import { productionRuns } from "@/db/schema";

/**
 * A production run's calendar date, derived from `start_time` (issue #259 dropped
 * the standalone `date` column). Casting a `timestamp` to `date` truncates the
 * stored wall-clock with no timezone math, so it matches `start_time` exactly
 * and returns the same 'YYYY-MM-DD' string shape the old column had — consumers
 * that select or filter on the run date keep working unchanged.
 */
export function productionRunDateExpr(): SQL<string> {
  return sql<string>`(${productionRuns.startTime})::date`;
}
