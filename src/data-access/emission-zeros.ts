import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type DbTransaction } from "@/db";
import { certifierRemovals, certificationSubmissions, creditBatchApplications, emissionEntries } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { requireEmissionsEntriesEnabled } from "@/lib/certification/emissions-entry-gate";
import { entryLine } from "@/lib/certification/emission-entry-rules";
import { isLiveEntryReservation, removalEntryOwner } from "@/lib/certification/removal-emission-contributions";
import { validateLineSources } from "@/lib/isometric/template-observations/line-sources";
import { SafeError } from "@/lib/errors";
import { recordEmissionZerosSchema, undoEmissionZerosSchema } from "@/schemas/emission-zeros";
import { lockedBatch } from "./emission-entries";
import { loadBatchEmissionEntryFacts } from "./emission-entry-facts";
import { listEmissionEntryDraftContenders, loadEmissionEntryReservations } from "./emission-entry-contenders";
import { recordEmissionEntryActivity } from "./emission-entry-activity";
import { assertRowVersion, nextVersion } from "./row-version";
import { requireOrgScope } from "./utils";
import { hasFreshRemovalDeletionLease } from "@/lib/certification/removal-deletion-lease";

async function lockZeroDraft(ctx: OrgContext, tx: DbTransaction, data: z.infer<typeof undoEmissionZerosSchema>, expectedVersion?: number) {
  requireOrgScope(ctx);
  const context = await lockedBatch(ctx, tx, data.creditBatchId);
  const [removal] = await tx.select().from(certifierRemovals).where(and(
    eq(certifierRemovals.organizationId, ctx.organizationId), eq(certifierRemovals.id, data.removalId),
  )).for("update");
  const members = await tx.select({ id: creditBatchApplications.id }).from(creditBatchApplications).where(and(
    eq(creditBatchApplications.organizationId, ctx.organizationId), eq(creditBatchApplications.creditBatchId, data.creditBatchId),
    eq(creditBatchApplications.removalId, data.removalId),
  ));
  if (!removal || !members.length || hasFreshRemovalDeletionLease(removal.metadata)) throw new SafeError("This credit batch is not on an editable Removal.");
  const submissions = await tx.select().from(certificationSubmissions).where(and(
    eq(certificationSubmissions.organizationId, ctx.organizationId), eq(certificationSubmissions.localEntityId, data.removalId),
    eq(certificationSubmissions.localEntityType, "removal"), eq(certificationSubmissions.submissionType, "removal"),
  ));
  if (submissions.some((row) => row.submittedAt || row.status === "submitted" || row.status === "accepted" || isLiveEntryReservation(row, Date.now()))) {
    throw new SafeError("Recorded zeros can only be changed on an unsubmitted, idle Removal.");
  }
  // Removals have no integer row version; use the persisted updatedAt millisecond token returned by the empty-lines read.
  if (expectedVersion !== undefined) assertRowVersion({ entity: "removal", id: removal.id, expectedVersion, actualVersion: removal.updatedAt.getTime() });
  return context;
}

export async function recordEmissionZeros(ctx: OrgContext, input: z.input<typeof recordEmissionZerosSchema>) {
  requireOrgScope(ctx);
  requireEmissionsEntriesEnabled();
  const data = recordEmissionZerosSchema.parse(input);
  return db.transaction(async (tx) => {
    const { batch, observation } = await lockZeroDraft(ctx, tx, data, data.expectedRemovalVersion);
    const { entries } = await loadBatchEmissionEntryFacts(ctx, batch.id, observation, tx);
    const contenders = await listEmissionEntryDraftContenders(ctx, [batch.id], tx);
    const reservations = await loadEmissionEntryReservations(ctx, entries.flatMap((entry) => entry.sendReservedBySubmissionId ? [entry.sendReservedBySubmissionId] : []), tx);
    const problems = validateLineSources(observation.definition, observation.lineSources);
    const saved = [];
    for (const componentId of [...new Set(data.componentIds)].sort()) {
      const line = entryLine(observation, componentId);
      if (!line || line.contract.scope !== "operating" || line.entryPolicy === "none" || problems.some((problem) => problem.componentId === componentId)) {
        throw new SafeError("This template line does not allow entries. Review its setup.");
      }
      if (entries.some((entry) => {
        const reservation = reservations.find((row) => row.submissionId === entry.sendReservedBySubmissionId);
        const live = reservation && isLiveEntryReservation(reservation, Date.now());
        return entry.componentId === componentId && entry.kind === "value" && entry.counts && !entry.unitMismatch &&
          removalEntryOwner({ ...entry, reservedByRemovalId: live ? reservation.removalId : null, reservationKnownInactive: !live }, contenders) === data.removalId;
      })) throw new SafeError("This line already has a value for this Removal.");
      const existing = entries.find((entry) => entry.componentId === componentId && entry.kind === "zero" && entry.confirmedForRemovalId === data.removalId);
      if (existing) { saved.push(existing.id); continue; }
      const [entry] = await tx.insert(emissionEntries).values({
        organizationId: ctx.organizationId, creditBatchId: batch.id, removalTemplateId: observation.externalTemplateId,
        observationId: observation.id, componentId, kind: "zero", confirmedForRemovalId: data.removalId,
        occurredOn: batch.startDate, inputShape: line.component.inputs.filter((input) => input.type === "monitored"),
        lineRule: line.entryPolicy, note: data.note, createdBy: ctx.userId,
      }).returning();
      await recordEmissionEntryActivity(ctx, tx, "created", null, { ...entry, values: [] });
      saved.push(entry.id);
    }
    return { entryIds: saved };
  });
}

export async function undoEmissionZeros(ctx: OrgContext, input: z.input<typeof undoEmissionZerosSchema>) {
  requireOrgScope(ctx);
  requireEmissionsEntriesEnabled();
  const data = undoEmissionZerosSchema.parse(input);
  return db.transaction(async (tx) => {
    await lockZeroDraft(ctx, tx, data);
    const rows = await tx.select().from(emissionEntries).where(and(eq(emissionEntries.organizationId, ctx.organizationId),
      eq(emissionEntries.creditBatchId, data.creditBatchId), eq(emissionEntries.confirmedForRemovalId, data.removalId), isNull(emissionEntries.deletedAt),
    )).orderBy(emissionEntries.id).for("update");
    if (rows.some((entry) => entry.sentByRemovalId || entry.sendReservedBySubmissionId)) throw new SafeError("These recorded zeros are reserved or sent. They cannot be changed.");
    for (const row of rows) {
      const [saved] = await tx.update(emissionEntries).set({ deletedAt: sql`now()`, updatedAt: sql`now()`,
        version: nextVersion(emissionEntries.version), contentRevision: nextVersion(emissionEntries.contentRevision),
      }).where(and(eq(emissionEntries.organizationId, ctx.organizationId), eq(emissionEntries.id, row.id))).returning();
      await recordEmissionEntryActivity(ctx, tx, "deleted", { ...row, values: [] }, { ...saved, values: [] });
    }
    return { entryIds: rows.map((row) => row.id) };
  });
}
