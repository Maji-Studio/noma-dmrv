import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { creditBatches, facilities } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import { requireOrgFacility, requireOrgScope } from "./utils";

export async function loadFacilityEmissionsOverviewScope(ctx: OrgContext, facilityId: string) {
  requireOrgScope(ctx);
  await requireOrgFacility(ctx, facilityId);
  const [[facility], batches] = await Promise.all([
    db.select({ timezone: facilities.timezone }).from(facilities).where(and(
      eq(facilities.organizationId, ctx.organizationId), eq(facilities.id, facilityId),
    )),
    db.select({
      id: creditBatches.id, code: creditBatches.code, startDate: creditBatches.startDate,
      endDate: creditBatches.endDate, status: creditBatches.status,
      removalTemplateId: creditBatches.removalTemplateId,
    }).from(creditBatches).where(and(
      eq(creditBatches.organizationId, ctx.organizationId), eq(creditBatches.facilityId, facilityId),
      isNull(creditBatches.archivedAt),
    )).orderBy(desc(creditBatches.startDate), desc(creditBatches.id)),
  ]);
  if (!facility) throw new SafeError("Facility was not found.");
  return { timezone: facility.timezone, batches };
}
