import { and, eq, inArray, isNull } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { facilities } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import { runReferenceNotFound } from "@/lib/production-run-domain-errors";
import { requireOrgScope } from "./utils";

/** Lock facility references in id order, including archived facilities. */
export async function lockFacilityReferences(
  ctx: OrgContext,
  tx: DbTransaction,
  facilityIds: readonly string[],
): Promise<void> {
  requireOrgScope(ctx);
  const ids = [...new Set(facilityIds)].sort();
  if (ids.length === 0) return;

  const rows = await tx
    .select({ id: facilities.id })
    .from(facilities)
    .where(and(inArray(facilities.id, ids), eq(facilities.organizationId, ctx.organizationId)))
    .orderBy(facilities.id)
    .for("share");

  if (rows.length !== ids.length) {
    throw runReferenceNotFound("Facility not found", ["facilityId"]);
  }
}

/**
 * Hold an active facility stable while creating a facility-scoped child.
 *
 * Facility archive takes a FOR UPDATE lock before cascading to its children.
 * Taking the compatible SHARE lock first makes either the child write complete
 * before that cascade, or makes the writer observe the completed archive.
 */
export async function lockActiveFacilityReference(
  ctx: OrgContext,
  tx: DbTransaction,
  facilityId: string,
): Promise<void> {
  requireOrgScope(ctx);
  const [facility] = await tx
    .select({ id: facilities.id })
    .from(facilities)
    .where(
      and(
        eq(facilities.id, facilityId),
        eq(facilities.organizationId, ctx.organizationId),
        isNull(facilities.archivedAt),
      ),
    )
    .for("share");

  if (!facility) {
    throw new SafeError("Facility not found or archived");
  }
}
