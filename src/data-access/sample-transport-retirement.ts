import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { documents, transportLegs } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { requireEmissionsEntriesEnabled } from "@/lib/certification/emissions-entry-gate";
import { SafeError } from "@/lib/errors";
import { deleteTransportLeg } from "./transport-legs";
import { requireOrgScope } from "./utils";

function requireRetirementAuthority(ctx: OrgContext): void {
  requireOrgScope(ctx);
  if (!ctx.isPlatformAdmin) throw new SafeError("Sample transport retirement requires a Platform Admin.");
}

/** Includes archived parents: retirement is organization-wide, not a facility view. */
export async function listSampleTransportRetirementCandidates(ctx: OrgContext) {
  requireOrgScope(ctx);
  requireRetirementAuthority(ctx);
  const legs = await db.select({
    id: transportLegs.id, organizationId: transportLegs.organizationId,
    entityType: transportLegs.entityType, version: transportLegs.version,
  }).from(transportLegs).where(and(
    eq(transportLegs.organizationId, ctx.organizationId),
    eq(transportLegs.entityType, "sample"),
  )).orderBy(asc(transportLegs.id));
  const ownedDocuments = legs.length ? await db.select({ id: documents.id, entityId: documents.entityId })
    .from(documents).where(and(
      eq(documents.organizationId, ctx.organizationId),
      eq(documents.entityType, "transport_leg"),
      inArray(documents.entityId, legs.map((leg) => leg.id)),
    )).orderBy(asc(documents.id)) : [];
  return legs.map((leg) => ({ ...leg, documentIds: ownedDocuments.filter((document) => document.entityId === leg.id).map((document) => document.id) }));
}

/** Reuses lineage/version guards, transactional activity and owned-document retirement. */
export async function deleteSampleTransportLegForRetirement(ctx: OrgContext, id: string, expectedVersion: number): Promise<boolean> {
  requireOrgScope(ctx);
  requireRetirementAuthority(ctx);
  requireEmissionsEntriesEnabled();
  const [leg] = await db.select({ id: transportLegs.id }).from(transportLegs).where(and(
    eq(transportLegs.organizationId, ctx.organizationId),
    eq(transportLegs.entityType, "sample"),
    eq(transportLegs.id, id),
  ));
  if (!leg) return false;
  await deleteTransportLeg(ctx, id, expectedVersion, "system");
  return true;
}
