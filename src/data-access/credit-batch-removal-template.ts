import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { creditBatches } from "@/db/schema/credits";
import { facilities } from "@/db/schema/facilities";
import { requireOrgRole, type OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import { recordActivity } from "./activity-events";
import { assertCanMutateCertifiedLineage } from "./certification-lineage-guards";
import { assertRemovalAllowsCreditBatchMutation, lockCreditBatchArtifacts } from "./credit-batch-certification-lock";
import { acquireFacilityCertificationBoundaryLock } from "./facility-certification-boundary-lock";
import { assertRowVersion, nextVersion } from "./row-version";
import { requireOrgScope } from "./utils";

export async function listPinnedRemovalTemplateIds(ctx: OrgContext, facilityId: string): Promise<string[]> {
  requireOrgScope(ctx);
  const rows = await db.selectDistinct({ id: creditBatches.removalTemplateId }).from(creditBatches).where(and(
    eq(creditBatches.organizationId, ctx.organizationId), eq(creditBatches.facilityId, facilityId),
    isNotNull(creditBatches.removalTemplateId),
  ));
  return rows.flatMap((row) => row.id ? [row.id] : []);
}

export interface SwitchCreditBatchRemovalTemplateInput {
  creditBatchId: string; removalTemplateId: string; expectedVersion: number;
}

export async function switchCreditBatchRemovalTemplate(ctx: OrgContext, input: SwitchCreditBatchRemovalTemplateInput) {
  requireOrgScope(ctx);
  requireOrgRole(ctx, "admin");
  return db.transaction(async (tx) => {
    const [target] = await tx.select({ facilityId: creditBatches.facilityId }).from(creditBatches).where(and(
      eq(creditBatches.organizationId, ctx.organizationId), eq(creditBatches.id, input.creditBatchId),
    ));
    if (!target) throw new SafeError("Credit batch not found.");
    // Submit paths take this lock first; holding it keeps a switch out of a claim in flight.
    await acquireFacilityCertificationBoundaryLock(ctx, tx, target.facilityId);
    const lockedRemovals = await lockCreditBatchArtifacts(ctx, tx, input.creditBatchId);
    const [batch] = await tx.select().from(creditBatches).where(and(
      eq(creditBatches.organizationId, ctx.organizationId), eq(creditBatches.id, input.creditBatchId),
    )).for("update");
    if (!batch) throw new SafeError("Credit batch not found.");
    assertRowVersion({ entity: "creditBatch", id: batch.id, expectedVersion: input.expectedVersion, actualVersion: batch.version });
    if (batch.archivedAt) throw new SafeError("This credit batch is archived. Restore the facility before switching its template.");
    const [facility] = await tx.select({ archivedAt: facilities.archivedAt }).from(facilities).where(and(
      eq(facilities.organizationId, ctx.organizationId), eq(facilities.id, batch.facilityId),
    ));
    if (!facility || facility.archivedAt) throw new SafeError("Facility not found or archived.");
    await assertRemovalAllowsCreditBatchMutation(ctx, tx, batch.id, "update", lockedRemovals);
    await assertCanMutateCertifiedLineage(ctx, tx, { entityType: "creditBatch", entityId: batch.id }, "update");
    const [updated] = await tx.update(creditBatches).set({
      removalTemplateId: input.removalTemplateId, version: nextVersion(creditBatches.version), updatedAt: new Date(),
    }).where(and(eq(creditBatches.organizationId, ctx.organizationId), eq(creditBatches.id, batch.id))).returning();
    await recordActivity(ctx, tx, {
      entityType: "credit_batch", entityId: batch.id, creditBatchId: batch.id, facilityId: batch.facilityId,
      action: "updated", source: "form", changedFields: ["removalTemplateId"],
    });
    return updated;
  });
}
