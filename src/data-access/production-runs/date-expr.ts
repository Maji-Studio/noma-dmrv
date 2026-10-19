import { sql, type SQL } from "drizzle-orm";

/** The facility-local start day is what lists, dashboards and display show. */
export function productionRunDateExpr(organizationId: string): SQL<string> {
  return productionRunFacilityDateExpr<string>(sql`"production_runs"."start_time"`, organizationId);
}

/** The facility-local end day decides credit batch membership (#1099, ADR 0016). */
export function productionRunMembershipDateExpr(organizationId: string): SQL<string | null> {
  return productionRunFacilityDateExpr<string | null>(sql`"production_runs"."end_time"`, organizationId);
}

/**
 * Stored timestamps represent UTC instants. The scalar subquery keeps run
 * FOR UPDATE reads from also locking facilities and changing the lock order.
 * Qualified columns also preserve correlation in Drizzle single-table selects.
 */
function productionRunFacilityDateExpr<T extends string | null>(timestamp: SQL, organizationId: string): SQL<T> {
  return sql<T>`(${timestamp} AT TIME ZONE 'UTC' AT TIME ZONE (
    SELECT "facilities"."timezone"
    FROM "facilities"
    WHERE "facilities"."id" = "production_runs"."facility_id"
      AND "facilities"."organization_id" = ${organizationId}
  ))::date`;
}
