import { and, eq, isNotNull } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { creditBatches } from "@/db/schema/credits";
import { facilities } from "@/db/schema/facilities";
import { requireOrgRole, type OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";
import { SafeError } from "@/lib/errors";
import { recordActivityChange } from "./activity-events";
import { assertCanMutateCertifiedLineage } from "./certification-lineage-guards";
import { assertRemovalAllowsCreditBatchMutation, lockCreditBatchArtifacts } from "./credit-batch-certification-lock";
import { acquireFacilityCertificationBoundaryLock } from "./facility-certification-boundary-lock";
import { assertRowVersion, nextVersion, staleRowVersion } from "./row-version";
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
  creditBatchId: string; removalTemplateId: string; expectedVersion: number | undefined;
}

export type TemplateKeptReason = "archived" | "removalSent" | "certified";

/** Only a domain lock refusal is skippable; concurrency and infrastructure failures propagate. */
async function templateGuardReason(guard: () => Promise<void>, reason: TemplateKeptReason) {
  try { await guard(); return null; }
  catch (error) {
    if (error instanceof DomainError && error.code === "certification_locked") return reason;
    throw error;
  }
}

export async function switchCreditBatchRemovalTemplateInTransaction(ctx: OrgContext, tx: DbTransaction, input: SwitchCreditBatchRemovalTemplateInput, setup: { facilityId: string; expectedTemplateId: string | null }) {
  requireOrgScope(ctx);
  requireOrgRole(ctx, "admin");
  const [target] = await tx.select({ facilityId: creditBatches.facilityId }).from(creditBatches).where(and(
    eq(creditBatches.organizationId, ctx.organizationId), eq(creditBatches.id, input.creditBatchId),
  ));
  if (!target) throw new SafeError("Credit batch not found.");
  if (target.facilityId !== setup.facilityId) throw staleRowVersion("creditBatch", input.creditBatchId);
  // Submit paths take this lock first; holding it keeps a switch out of a claim in flight.
  await acquireFacilityCertificationBoundaryLock(ctx, tx, target.facilityId);
  const lockedRemovals = await lockCreditBatchArtifacts(ctx, tx, input.creditBatchId);
  const [batch] = await tx.select().from(creditBatches).where(and(
    eq(creditBatches.organizationId, ctx.organizationId), eq(creditBatches.id, input.creditBatchId),
  )).for("update");
  if (!batch) throw new SafeError("Credit batch not found.");
  if (batch.facilityId !== setup.facilityId) throw staleRowVersion("creditBatch", batch.id);
  if (batch.removalTemplateId === input.removalTemplateId) return { status: "unchanged" as const, batch };
  if (batch.archivedAt) return { status: "kept" as const, batch, reason: "archived" as const };
  const [facility] = await tx.select({ archivedAt: facilities.archivedAt }).from(facilities).where(and(
    eq(facilities.organizationId, ctx.organizationId), eq(facilities.id, batch.facilityId),
  ));
  if (!facility || facility.archivedAt) throw new SafeError("Facility not found or archived.");
  const reason = await templateGuardReason(
    () => assertRemovalAllowsCreditBatchMutation(ctx, tx, batch.id, "update", lockedRemovals), "removalSent",
  ) ?? await templateGuardReason(
    () => assertCanMutateCertifiedLineage(ctx, tx, { entityType: "creditBatch", entityId: batch.id }, "update"), "certified",
  );
  if (reason) return { status: "kept" as const, batch, reason };
  if (input.expectedVersion === undefined) throw staleRowVersion("creditBatch", batch.id);
  assertRowVersion({ entity: "creditBatch", id: batch.id, expectedVersion: input.expectedVersion, actualVersion: batch.version });
  if (batch.removalTemplateId !== setup.expectedTemplateId) throw staleRowVersion("creditBatch", batch.id);
  const [updated] = await tx.update(creditBatches).set({
    removalTemplateId: input.removalTemplateId, version: nextVersion(creditBatches.version), updatedAt: new Date(),
  }).where(and(eq(creditBatches.organizationId, ctx.organizationId), eq(creditBatches.id, batch.id))).returning();
  await recordActivityChange(ctx, tx, {
    entityType: "credit_batch", entityId: batch.id, creditBatchId: batch.id, facilityId: batch.facilityId,
    action: "updated", source: "form",
  }, batch, updated);
  return { status: "updated" as const, batch: updated };
}
