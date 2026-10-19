import { and, asc, eq, isNull } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import type { CreditBatch } from "@/db/schema/credits";
import { emissionEntries } from "@/db/schema/emission-entries";
import type { OrgContext } from "@/lib/auth/server";
import { conflictCode } from "@/lib/conflict-ref";
import { formatCreditBatchEntryDateConflict } from "@/lib/credit-batch-entry-dates";
import { DomainError } from "@/lib/domain-errors";
import { ActionConflictError } from "@/lib/errors";
import { recordActivityChange } from "./activity-events";
import { getTemplateObservationsByIds } from "./removal-template-observations";
import { nextVersion } from "./row-version";
import { requireOrgScope } from "./utils";

/** Caller holds the batch lock. Check every refusal before writing any entry. */
export async function syncCreditBatchEntryDates(
  ctx: OrgContext,
  tx: DbTransaction,
  batch: CreditBatch,
  startDate: string,
  endDate: string,
) {
  requireOrgScope(ctx);
  if (startDate === batch.startDate && endDate === batch.endDate) return;
  const entries = await tx.select().from(emissionEntries).where(and(
    eq(emissionEntries.organizationId, ctx.organizationId),
    eq(emissionEntries.creditBatchId, batch.id),
    isNull(emissionEntries.deletedAt),
  )).orderBy(asc(emissionEntries.id)).for("update");

  const narrowsWindow = startDate > batch.startDate || endDate < batch.endDate;
  const outside = entries.filter((entry) => narrowsWindow && entry.lineRule !== "single" &&
    (entry.occurredOn < startDate || entry.occurredOn > endDate));
  if (outside.length) {
    const observations = await getTemplateObservationsByIds(ctx, outside.map((entry) => entry.observationId), tx);
    const names = new Map(observations.map((observation) => [observation.id,
      new Map(observation.definition.groups.flatMap((group) =>
        group.components.map((component) => [component.id, component.displayName] as const))),
    ]));
    throw new ActionConflictError(
      formatCreditBatchEntryDateConflict(batch.code, outside.map((entry) => ({
        displayName: names.get(entry.observationId)?.get(entry.componentId) ?? "Manual entry",
        occurredOn: entry.occurredOn,
      }))),
      { entity: "credit_batch", id: batch.id, code: conflictCode(batch.code) },
    );
  }

  const toRedate = entries.filter((entry) => entry.lineRule === "single" &&
    startDate !== batch.startDate && entry.occurredOn !== startDate);
  // Match the entry writer's reserved/sent guard, including when the feature is off.
  if (toRedate.some((entry) => entry.sentByRemovalId || entry.sendReservedBySubmissionId)) {
    throw new DomainError("certification_locked", "This emissions entry is reserved or sent. It cannot be changed.");
  }
  for (const before of toRedate) {
    const [after] = await tx.update(emissionEntries).set({
      occurredOn: startDate,
      version: nextVersion(emissionEntries.version),
      contentRevision: nextVersion(emissionEntries.contentRevision),
      updatedAt: new Date(),
    }).where(and(
      eq(emissionEntries.organizationId, ctx.organizationId),
      eq(emissionEntries.id, before.id),
    )).returning();
    await recordActivityChange(ctx, tx, {
      entityType: "emission_entry", entityId: before.id, creditBatchId: batch.id,
      action: "updated", source: "form",
    }, before, after);
  }
}
