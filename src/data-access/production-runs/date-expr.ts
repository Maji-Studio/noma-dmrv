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
  return facilityDateExpr<T>(timestamp, sql`"production_runs"."facility_id"`, organizationId);
}

/** Resolve an ISO instant on the facility calendar, using its org-scoped zone. */
export function facilityInstantDateExpr(organizationId: string, facilityId: string, iso: string): SQL<string | null> {
  // Stored timestamp columns are UTC wall clock; normalize the parameter to
  // that same representation before applying the shared conversion.
  return facilityDateExpr<string | null>(sql`(${iso}::timestamptz AT TIME ZONE 'UTC')`, sql`${facilityId}`, organizationId);
}

function facilityDateExpr<T extends string | null>(timestamp: SQL, facilityId: SQL, organizationId: string): SQL<T> {
  return sql<T>`(${timestamp} AT TIME ZONE 'UTC' AT TIME ZONE (
    SELECT "facilities"."timezone"
    FROM "facilities"
    WHERE "facilities"."id" = ${facilityId}
      AND "facilities"."organization_id" = ${organizationId}
  ))::date`;
}
