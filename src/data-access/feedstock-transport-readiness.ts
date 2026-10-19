import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { transportLegs } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { missingFeedstockTransportIds } from "@/lib/certification/submission-readiness";
import { requireOrgScope, type Executor } from "./utils";

/** One scoped read for the page, including manual as well as derived legs. */
export async function withFeedstockTransportReadiness<T extends { id: string }>(
  ctx: OrgContext,
  feedstocks: T[],
  executor: Executor = db,
) {
  requireOrgScope(ctx);
  const ids = feedstocks.map((feedstock) => feedstock.id);
  const legs = ids.length ? await executor.select({
    entityId: transportLegs.entityId,
    distanceKm: transportLegs.distanceKm,
    loadMassKg: transportLegs.loadMassKg,
    distanceSource: transportLegs.distanceSource,
  }).from(transportLegs).where(and(
    eq(transportLegs.organizationId, ctx.organizationId),
    eq(transportLegs.entityType, "feedstock"),
    inArray(transportLegs.entityId, ids),
  )) : [];
  const missingIds = new Set(missingFeedstockTransportIds(ids, legs));
  const sourceById = new Map(legs.filter((leg) => leg.distanceSource != null).map((leg) => [leg.entityId, leg.distanceSource]));
  return feedstocks.map((feedstock) => ({
    ...feedstock,
    hasUsableTransportLeg: !missingIds.has(feedstock.id),
    transportLegDistanceSource: sourceById.get(feedstock.id) ?? null,
  }));
}
