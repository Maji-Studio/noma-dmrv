import { getTableName, sql } from "drizzle-orm";
import { customerLocations, supplierLocations, customerLocationFacilityDistances, supplierLocationFacilityDistances, facilities } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import type { FacilityDistance } from "@/schemas/facility-distances";
import { requireOrgScope } from "./utils";

/** API bodies retain archived-facility pairs without changing the location version. */
export function apiLocationFacilityDistances(ctx: OrgContext, kind: "supplier" | "customer") {
  requireOrgScope(ctx);
  const pairs = kind === "supplier" ? supplierLocationFacilityDistances : customerLocationFacilityDistances;
  const locations = kind === "supplier" ? supplierLocations : customerLocations;
  // Explicit identifiers preserve outer qualification inside a single-table SELECT.
  const locationTable = sql.identifier(getTableName(locations));
  return sql<FacilityDistance[]>`(
    select coalesce(json_agg(json_build_object(
      'facilityId', pair.facility_id,
      'facilityName', facility.name,
      'distanceKm', pair.distance_km,
      'distanceSource', pair.distance_source
    ) order by pair.facility_id), '[]'::json)
    from ${pairs} as pair
    inner join ${facilities} as facility
      on facility.id = pair.facility_id
      and facility.organization_id = ${ctx.organizationId}
    where pair.organization_id = ${ctx.organizationId}
      and pair.location_id = ${locationTable}."id"
      and pair.organization_id = ${locationTable}."organization_id"
  )`;
}
