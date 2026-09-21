import type { DbTransaction } from "@/db";
import { applicationOutputAllocations, applications, creditBatchApplications, creditBatchProductionRuns } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { KG_PER_TONNE } from "@/lib/calculations/unit-conversions";
import { SafeError } from "@/lib/errors";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { massGrams } from "./delivery-allocation-math";
import { requireOrgScope } from "./utils";

export interface CreditBatchApplicationSlice {
  creditBatchId: string;
  applicationId: string;
  allocatedWetMassKg: number;
  allocatedDryMassKg: number;
  removalId: string | null;
}
interface ReconcileSliceScope {
  applicationIds?: string[];
  creditBatchIds?: string[];
  biocharProductIds?: string[];
}
/** Refresh only unowned slices from frozen application product/run shares. */
export async function reconcileUnassignedCreditBatchApplicationSlices(ctx: OrgContext, tx: DbTransaction, scope: ReconcileSliceScope): Promise<void> {
  requireOrgScope(ctx);
  const requestedBatchIds = [...new Set(scope.creditBatchIds ?? [])];
  const requestedApplicationIds = [...new Set(scope.applicationIds ?? [])];
  const requestedProductIds = [...new Set(scope.biocharProductIds ?? [])];
  if (!requestedBatchIds.length && !requestedApplicationIds.length && !requestedProductIds.length) return;
  const rows = await tx.select({
    applicationId: applicationOutputAllocations.applicationId,
    productId: applicationOutputAllocations.biocharProductId,
    creditBatchId: creditBatchProductionRuns.creditBatchId,
    wetMassKg: applicationOutputAllocations.wetMassKg,
    dryMassKg: applicationOutputAllocations.dryMassKg,
  }).from(applicationOutputAllocations)
    .innerJoin(creditBatchProductionRuns, and(eq(creditBatchProductionRuns.productionRunId, applicationOutputAllocations.productionRunId), eq(creditBatchProductionRuns.organizationId, ctx.organizationId)))
    .where(eq(applicationOutputAllocations.organizationId, ctx.organizationId));
  // Discover products independently of current membership so removing a run's
  // last batch link can retire its stale unowned slice as well.
  const productApplications = requestedProductIds.length ? await tx.select({ applicationId: applicationOutputAllocations.applicationId }).from(applicationOutputAllocations)
    .where(and(eq(applicationOutputAllocations.organizationId, ctx.organizationId), inArray(applicationOutputAllocations.biocharProductId, requestedProductIds))) : [];
  const applicationIds = [...new Set([...requestedApplicationIds, ...productApplications.map(row => row.applicationId), ...rows.filter(row => requestedBatchIds.includes(row.creditBatchId) || requestedProductIds.includes(row.productId)).map(row => row.applicationId)])];
  if (applicationIds.length) {
    const apps = await tx.select().from(applications).where(and(eq(applications.organizationId, ctx.organizationId), inArray(applications.id, applicationIds)));
    const shares = await tx.select().from(applicationOutputAllocations).where(and(eq(applicationOutputAllocations.organizationId, ctx.organizationId), inArray(applicationOutputAllocations.applicationId, applicationIds)));
    for (const app of apps) {
      const allocated = shares.filter(share => share.applicationId === app.id);
      if (!allocated.length || app.biocharAppliedDryTons == null ||
        allocated.reduce((sum, share) => sum + massGrams(Number(share.wetMassKg)), 0) !== massGrams(app.biocharAppliedTons * KG_PER_TONNE) ||
        allocated.reduce((sum, share) => sum + massGrams(Number(share.dryMassKg)), 0) !== massGrams(app.biocharAppliedDryTons * KG_PER_TONNE)) {
        throw new SafeError("Application has missing or unbalanced saved source allocations.");
      }
    }
  }
  const desired = new Map<string, CreditBatchApplicationSlice>();
  for (const row of rows) {
    if (!applicationIds.includes(row.applicationId)) continue;
    if (requestedBatchIds.length && !requestedBatchIds.includes(row.creditBatchId)) continue;
    const key = `${row.creditBatchId}:${row.applicationId}`;
    const slice = desired.get(key) ?? { creditBatchId: row.creditBatchId, applicationId: row.applicationId, allocatedWetMassKg: 0, allocatedDryMassKg: 0, removalId: null };
    slice.allocatedWetMassKg += Number(row.wetMassKg);
    slice.allocatedDryMassKg += Number(row.dryMassKg);
    desired.set(key, slice);
  }
  if (!applicationIds.length && !requestedBatchIds.length) return;
  const existing = await tx
    .select({
      creditBatchId: creditBatchApplications.creditBatchId,
      applicationId: creditBatchApplications.applicationId,
      removalId: creditBatchApplications.removalId,
    })
    .from(creditBatchApplications)
    .where(
      and(
        requestedBatchIds.length > 0
          ? inArray(creditBatchApplications.creditBatchId, requestedBatchIds)
          : inArray(creditBatchApplications.applicationId, applicationIds),
        eq(creditBatchApplications.organizationId, ctx.organizationId),
      ),
    );
  const assignedKeys = new Set(
    existing
      .filter((row) => row.removalId)
      .map((row) => `${row.creditBatchId}:${row.applicationId}`),
  );

  await tx.delete(creditBatchApplications).where(
    and(
      requestedBatchIds.length > 0
        ? inArray(creditBatchApplications.creditBatchId, requestedBatchIds)
        : inArray(creditBatchApplications.applicationId, applicationIds),
      isNull(creditBatchApplications.removalId),
      eq(creditBatchApplications.organizationId, ctx.organizationId),
    ),
  );
  const inserts = [...desired.entries()]
    .filter(([key]) => !assignedKeys.has(key))
    .map(([, row]) => ({ ...row, organizationId: ctx.organizationId }));
  if (inserts.length > 0) {
    // A concurrent Removal may assign a slice after the read above. Preserve
    // that assigned row instead of failing this reconciliation on the natural
    // (creditBatchId, applicationId) key.
    // org-scope-ok: every row above is stamped with the active organization id.
    await tx
      .insert(creditBatchApplications)
      .values(inserts)
      .onConflictDoNothing();
  }
}
