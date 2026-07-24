import { and, eq, isNull } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { facilities } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import { requireOrgScope } from "./utils";

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
