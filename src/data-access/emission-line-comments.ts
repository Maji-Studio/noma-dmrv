import { and, asc, eq, inArray } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { emissionLineComments } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";
import { requireEmissionsEntriesEnabled } from "@/lib/certification/emissions-entry-gate";
import { resolveBatchPin } from "@/lib/certification/resolve-batch-pin";
import { REMOVAL_TEMPLATE_BLOCKERS } from "@/lib/certification/removal-template-blockers";
import {
  setEmissionLineCommentSchema, deleteEmissionLineCommentSchema,
  type SetEmissionLineCommentInput, type DeleteEmissionLineCommentInput,
} from "@/schemas/emission-line-comments";
import { requireOrgScope, type Executor } from "./utils";
import { lockEmissionEntryBatch } from "./emission-entry-lock";
import { getLatestTemplateObservation } from "./removal-template-observations";
import { assertRowVersion, nextVersion, staleRowVersion } from "./row-version";
import { recordActivityChange } from "./activity-events";

export async function listEmissionLineComments(ctx: OrgContext, creditBatchId: string, executor: Executor = db) {
  requireOrgScope(ctx);
  return listEmissionLineCommentsForBatches(ctx, [creditBatchId], executor);
}

export async function listEmissionLineCommentsForBatches(ctx: OrgContext, creditBatchIds: string[], executor: Executor = db) {
  requireOrgScope(ctx);
  if (!creditBatchIds.length) return [];
  return executor.select().from(emissionLineComments).where(and(
    eq(emissionLineComments.organizationId, ctx.organizationId),
    inArray(emissionLineComments.creditBatchId, creditBatchIds),
  )).orderBy(asc(emissionLineComments.id));
}

export async function getEmissionLineComment(ctx: OrgContext, id: string, executor: Executor = db) {
  requireOrgScope(ctx);
  const [comment] = await executor.select().from(emissionLineComments).where(and(
    eq(emissionLineComments.organizationId, ctx.organizationId), eq(emissionLineComments.id, id),
  ));
  if (!comment) throw new DomainError("not_found", "Line comment was not found.");
  return comment;
}

/** Serialize creates and template switches on the batch, without a record-lock gate. */
async function lockCommentBatch(ctx: OrgContext, tx: DbTransaction, creditBatchId: string, facilityId?: string) {
  requireOrgScope(ctx);
  const { batch, facility } = await lockEmissionEntryBatch(ctx, tx, creditBatchId);
  if (batch.archivedAt || facility.archivedAt || (facilityId !== undefined && batch.facilityId !== facilityId))
    throw new DomainError("not_found", "Credit batch was not found.");
  return batch;
}

export async function setEmissionLineComment(ctx: OrgContext, input: SetEmissionLineCommentInput) {
  requireOrgScope(ctx);
  requireEmissionsEntriesEnabled();
  const data = setEmissionLineCommentSchema.parse(input);
  return db.transaction(async (tx) => {
    const batch = await lockCommentBatch(ctx, tx, data.creditBatchId, data.facilityId);
    const pin = resolveBatchPin([batch]);
    if ("code" in pin) throw new DomainError("validation_failed", REMOVAL_TEMPLATE_BLOCKERS[pin.code]);
    const observation = await getLatestTemplateObservation(ctx, "isometric", pin.pin, tx);
    if (!observation) throw new DomainError("validation_failed", REMOVAL_TEMPLATE_BLOCKERS.templateNotFullyRead);
    // Comments are allowed on every template component, including lines that cannot take entries.
    if (!observation.definition.groups.some((group) => group.components.some((line) => line.id === data.componentId)))
      throw new DomainError("validation_failed", "This template line is no longer available. Choose another line.");
    const [before] = await tx.select().from(emissionLineComments).where(and(
      eq(emissionLineComments.organizationId, ctx.organizationId),
      eq(emissionLineComments.creditBatchId, batch.id), eq(emissionLineComments.componentId, data.componentId),
    )).for("update");
    if (before) {
      if (data.expectedVersion === undefined)
        throw new DomainError("conflict", "This line already has a comment. Refresh and edit that comment.");
      if (data.id !== before.id) throw staleRowVersion("emission_line_comment", data.id!);
      assertRowVersion({ entity: "emission_line_comment", id: before.id,
        expectedVersion: data.expectedVersion, actualVersion: before.version });
      const [after] = await tx.update(emissionLineComments).set({
        body: data.body, updatedBy: ctx.userId, updatedAt: new Date(), version: nextVersion(emissionLineComments.version),
      }).where(and(eq(emissionLineComments.organizationId, ctx.organizationId), eq(emissionLineComments.id, before.id))).returning();
      await recordActivityChange(ctx, tx, {
        entityType: "emission_line_comment", entityId: after.id, creditBatchId: batch.id,
        action: "updated", source: "form",
      }, before, after);
      return after;
    }
    // A deleted comment must not be silently recreated by a stale edit.
    if (data.id !== undefined) throw staleRowVersion("emission_line_comment", data.id);
    const [after] = await tx.insert(emissionLineComments).values({
      organizationId: ctx.organizationId, creditBatchId: batch.id, componentId: data.componentId,
      body: data.body, createdBy: ctx.userId, updatedBy: ctx.userId,
    }).returning();
    await recordActivityChange(ctx, tx, {
      entityType: "emission_line_comment", entityId: after.id, creditBatchId: batch.id,
      action: "created", source: "form",
    }, null, after);
    return after;
  });
}

export async function deleteEmissionLineComment(ctx: OrgContext, input: DeleteEmissionLineCommentInput) {
  requireOrgScope(ctx);
  requireEmissionsEntriesEnabled();
  const data = deleteEmissionLineCommentSchema.parse(input);
  return db.transaction(async (tx) => {
    const initial = await getEmissionLineComment(ctx, data.id, tx);
    await lockCommentBatch(ctx, tx, initial.creditBatchId, data.facilityId);
    const [before] = await tx.select().from(emissionLineComments).where(and(
      eq(emissionLineComments.organizationId, ctx.organizationId), eq(emissionLineComments.id, data.id),
    )).for("update");
    if (!before) throw staleRowVersion("emission_line_comment", data.id);
    assertRowVersion({ entity: "emission_line_comment", id: before.id,
      expectedVersion: data.expectedVersion, actualVersion: before.version });
    await tx.delete(emissionLineComments).where(and(
      eq(emissionLineComments.organizationId, ctx.organizationId), eq(emissionLineComments.id, before.id),
    ));
    await recordActivityChange(ctx, tx, {
      entityType: "emission_line_comment", entityId: before.id, creditBatchId: before.creditBatchId,
      action: "deleted", source: "form",
    }, before, null);
    return { id: before.id };
  });
}
