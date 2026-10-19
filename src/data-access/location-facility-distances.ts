import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { facilities, customerLocations, supplierLocations, customerLocationFacilityDistances, supplierLocationFacilityDistances } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { facilityDistancesInputSchema, type FacilityDistanceInput } from "@/schemas/facility-distances";
import { assertSameOrg, requireOrgScope, type Executor } from "./utils";
import { fillMissingLocationDistances, type LocationDistanceFillResult, type CaptureFilledDelivery } from "./location-distance-fill";
import { lockActiveFacilityReference } from "./facility-reference-guards";
import { nextVersion } from "./row-version";

type LocationKind = "supplier" | "customer";

export async function getLocationFacilityDistances(
  ctx: OrgContext, kind: LocationKind, locationId: string, executor: Executor = db,
) {
  requireOrgScope(ctx);
  const table = kind === "supplier" ? supplierLocationFacilityDistances : customerLocationFacilityDistances;
  await assertSameOrg(ctx, kind === "supplier" ? supplierLocations : customerLocations, locationId, executor);
  return executor.select({ facilityId: table.facilityId, distanceKm: table.distanceKm, distanceSource: table.distanceSource })
    .from(table).where(and(eq(table.organizationId, ctx.organizationId), eq(table.locationId, locationId)))
    .orderBy(asc(table.facilityId));
}

export async function withLocationFacilityDistances<T extends { id: string }>(
  ctx: OrgContext, kind: LocationKind, locations: T[], executor: Executor = db,
) {
  requireOrgScope(ctx);
  const table = kind === "supplier" ? supplierLocationFacilityDistances : customerLocationFacilityDistances;
  const rows = locations.length ? await executor.select({
    locationId: table.locationId, facilityName: facilities.name, facilityId: table.facilityId, distanceKm: table.distanceKm, distanceSource: table.distanceSource,
  }).from(table).innerJoin(facilities, and(eq(facilities.id, table.facilityId), eq(facilities.organizationId, ctx.organizationId), isNull(facilities.archivedAt))).where(and(eq(table.organizationId, ctx.organizationId), inArray(table.locationId, locations.map(row => row.id))))
    .orderBy(asc(table.facilityId)) : [];
  return locations.map(location => ({ ...location, facilityDistances: rows.filter(row => row.locationId === location.id)
    .map(({ facilityId, facilityName, distanceKm, distanceSource }) => ({ facilityId, facilityName, distanceKm, distanceSource })) }));
}

/** Pair writes and filling missing transport facts share the location writer's transaction. */
export async function upsertLocationFacilityDistances(
  ctx: OrgContext, tx: DbTransaction, kind: LocationKind, locationId: string,
  input: FacilityDistanceInput[] | undefined,
  options: { deferFill?: boolean; captureDelivery?: CaptureFilledDelivery } = {},
): Promise<LocationDistanceFillResult> {
  requireOrgScope(ctx);
  const rows = facilityDistancesInputSchema.parse(input);
  if (rows === undefined) return { filled: 0, skipped: { submitted: 0, concurrent: 0, repointed: 0 } };
  const table = kind === "supplier" ? supplierLocationFacilityDistances : customerLocationFacilityDistances;
  await assertSameOrg(ctx, kind === "supplier" ? supplierLocations : customerLocations, locationId, tx);
  for (const row of [...rows].sort((a, b) => a.facilityId.localeCompare(b.facilityId))) {
    if (row.distanceKm !== null) await lockActiveFacilityReference(ctx, tx, row.facilityId);
  }
  for (const row of rows) {
    if (row.distanceKm === null) {
      await tx.delete(table).where(and(eq(table.organizationId, ctx.organizationId), eq(table.locationId, locationId), eq(table.facilityId, row.facilityId)));
    } else {
      await tx.insert(table).values({ ...row, distanceKm: row.distanceKm, locationId, organizationId: ctx.organizationId })
        .onConflictDoUpdate({ target: [table.locationId, table.facilityId], set: {
          distanceKm: row.distanceKm, distanceSource: row.distanceSource,
          version: nextVersion(table.version), updatedAt: new Date(),
        }, setWhere: eq(table.organizationId, ctx.organizationId) });
    }
  }
  if (!options.deferFill) {
    return fillMissingLocationDistances(ctx, tx, kind, locationId,
      rows.flatMap(row => row.distanceKm === null ? [] : [{ ...row, distanceKm: row.distanceKm }]), options.captureDelivery);
  }
  return { filled: 0, skipped: { submitted: 0, concurrent: 0, repointed: 0 } };
}
