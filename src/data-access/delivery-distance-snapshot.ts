import { and, eq } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { customerLocationFacilityDistances, orders } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import type { DistanceSourceValue } from "@/schemas/distance-source";
import { requireOrgScope } from "./utils";

/** Capture the route at delivery save time, independently of its optional override. */
export async function deliveryDistanceSnapshot(
  ctx: OrgContext, tx: DbTransaction,
  delivery: { orderId: string; facilityId: string; distanceKmOverride: number | null; distanceSource: DistanceSourceValue | null },
) {
  requireOrgScope(ctx);
  const [pair] = await tx.select({
    distanceKm: customerLocationFacilityDistances.distanceKm,
    distanceSource: customerLocationFacilityDistances.distanceSource,
  }).from(orders).leftJoin(customerLocationFacilityDistances, and(
    eq(customerLocationFacilityDistances.organizationId, ctx.organizationId),
    eq(customerLocationFacilityDistances.locationId, orders.customerLocationId),
    eq(customerLocationFacilityDistances.facilityId, delivery.facilityId),
  )).where(and(eq(orders.organizationId, ctx.organizationId), eq(orders.id, delivery.orderId)));
  return { recordedDistanceKm: pair?.distanceKm ?? null, recordedDistanceSource: pair?.distanceSource ?? null };
}
