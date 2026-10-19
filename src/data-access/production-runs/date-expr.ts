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

/**
 * The facility-local end day decides credit batch membership (#1099, ADR 0016).
 * `productionRunDateExpr()` remains the UTC start day for displays and lists.
 */
export function productionRunMembershipDateExpr(organizationId: string): SQL<string | null> {
  return productionRunFacilityDateExpr(sql`"production_runs"."end_time"`, organizationId);
}

/** Facility-local start day for previewing runs without an end time. */
export function productionRunFacilityStartDateExpr(organizationId: string): SQL<string | null> {
  return productionRunFacilityDateExpr(sql`"production_runs"."start_time"`, organizationId);
}

/**
 * Stored timestamps represent UTC instants. The scalar subquery keeps run
 * FOR UPDATE reads from also locking facilities and changing the lock order.
 * Qualified columns also preserve correlation in Drizzle single-table selects.
 */
function productionRunFacilityDateExpr(timestamp: SQL, organizationId: string): SQL<string | null> {
  return sql<string | null>`(${timestamp} AT TIME ZONE 'UTC' AT TIME ZONE (
    SELECT "facilities"."timezone"
    FROM "facilities"
    WHERE "facilities"."id" = "production_runs"."facility_id"
      AND "facilities"."organization_id" = ${organizationId}
  ))::date`;
}
