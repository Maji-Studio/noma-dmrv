import { lockEmissionCorrectionScope, emissionCorrectionWindow } from "./emission-entry-corrections";
import { deriveRemovalEntryInputs } from "@/lib/certification/removal-entry-inputs";
import { isEnrichmentComplete } from "@/lib/isometric/template-observations/enrichment";
import { deriveRemovalEmissionLines, omittedProductionSources } from "@/lib/certification/removal-emission-lines";
import { loadBatchesEmissionAutomaticFacts } from "./batch-emission-automatic-figures";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type DbTransaction } from "@/db";
import { certifierRemovals, certificationSubmissions, creditBatchApplications, creditBatches, emissionEntries } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { entryLine } from "@/lib/certification/emission-entry-rules";
import { entriesWithoutRemoval, isLiveEntryReservation } from "@/lib/certification/removal-emission-contributions";
import { validateLineSources } from "@/lib/isometric/template-observations/line-sources";
import { DomainError } from "@/lib/domain-errors";
import { SafeError } from "@/lib/errors";
import { recordEmissionZerosSchema, undoEmissionZerosSchema } from "@/schemas/emission-zeros";
import { lockedBatch } from "./emission-entries";
import { loadBatchEmissionEntryFacts } from "./emission-entry-facts";
import { listEmissionEntryDraftContenders, listEmissionEntryAvailableApplications, loadEmissionEntryReservations } from "./emission-entry-contenders";
import { recordEmissionEntryActivity } from "./emission-entry-activity";
import { assertRowVersion, nextVersion } from "./row-version";
import { requireOrgScope } from "./utils";
import { hasFreshRemovalDeletionLease } from "@/lib/certification/removal-deletion-lease";

/** A submitted, accepted or in-flight attempt freezes the recorded zeros. */
function submissionsLockZeros(submissions: (typeof certificationSubmissions.$inferSelect)[]) {
  return submissions.some((row) => row.submittedAt || row.status === "submitted" || row.status === "accepted" || isLiveEntryReservation(row, Date.now()));
}

/** Whether recorded zeros may change now: the check `lockZeroDraft` applies, without the lock. */
export async function isRemovalZeroEditable(ctx: OrgContext, removalId: string): Promise<boolean> {
  requireOrgScope(ctx);
  const [removal] = await db.select().from(certifierRemovals).where(and(
    eq(certifierRemovals.organizationId, ctx.organizationId), eq(certifierRemovals.id, removalId),
  ));
  if (!removal || hasFreshRemovalDeletionLease(removal.metadata)) return false;
  const submissions = await db.select().from(certificationSubmissions).where(and(
    eq(certificationSubmissions.organizationId, ctx.organizationId), eq(certificationSubmissions.localEntityId, removalId),
    eq(certificationSubmissions.localEntityType, "removal"), eq(certificationSubmissions.submissionType, "removal"),
  ));
  if (!submissionsLockZeros(submissions)) return true;
  // A returned Removal with an open correction window may change its zeros, as `lockZeroDraft` allows.
  const members = await db.select({ id: creditBatchApplications.creditBatchId }).from(creditBatchApplications).where(and(
    eq(creditBatchApplications.organizationId, ctx.organizationId), eq(creditBatchApplications.removalId, removalId),
  ));
  const contenders = await listEmissionEntryDraftContenders(ctx, [...new Set(members.map((row) => row.id))]);
  return contenders.some((row) => row.removalId === removalId && row.contenderKind === "correction");
}

async function lockZeroDraft(ctx: OrgContext, tx: DbTransaction, data: z.infer<typeof undoEmissionZerosSchema>, expectedVersion?: number) {
  requireOrgScope(ctx);
  await lockEmissionCorrectionScope(ctx, tx, data.creditBatchId);
  // Stamping holds batch locks before its sentByRemovalId FK takes KEY SHARE here.
  // NO KEY UPDATE serializes zero writers without closing that batch/Removal cycle.
  const [removal] = await tx.select().from(certifierRemovals).where(and(
    eq(certifierRemovals.organizationId, ctx.organizationId), eq(certifierRemovals.id, data.removalId),
  )).for("no key update", { skipLocked: true });
  // Deletion takes the Removal row before its artifact. Never wait on that
  // inverse order while holding lineage artifacts.
  if (!removal) {
    const [existing] = await tx.select({ id: certifierRemovals.id }).from(certifierRemovals).where(and(
      eq(certifierRemovals.organizationId, ctx.organizationId), eq(certifierRemovals.id, data.removalId),
    ));
    if (existing) throw new DomainError("conflict", "This Removal is being updated. Refresh and retry.", { retryable: true });
    throw new SafeError("This credit batch is not on an editable Removal.");
  }
  const context = await lockedBatch(ctx, tx, data.creditBatchId);
  const members = await tx.select({ batch: creditBatches }).from(creditBatchApplications)
    .innerJoin(creditBatches, and(eq(creditBatches.id, creditBatchApplications.creditBatchId), eq(creditBatches.organizationId, ctx.organizationId))).where(and(
    eq(creditBatchApplications.organizationId, ctx.organizationId),
    eq(creditBatchApplications.removalId, data.removalId),
  ));
  if (!removal || !members.some(({ batch }) => batch.id === data.creditBatchId) || hasFreshRemovalDeletionLease(removal.metadata)) throw new SafeError("This credit batch is not on an editable Removal.");
  const submissions = await tx.select().from(certificationSubmissions).where(and(
    eq(certificationSubmissions.organizationId, ctx.organizationId), eq(certificationSubmissions.localEntityId, data.removalId),
    eq(certificationSubmissions.localEntityType, "removal"), eq(certificationSubmissions.submissionType, "removal"),
  ));
  const correction = emissionCorrectionWindow(ctx, tx, data.creditBatchId, data.removalId);
  if (!correction && submissionsLockZeros(submissions)) {
    throw new SafeError("Recorded zeros can only be changed on an unsubmitted, idle Removal.");
  }
  // Removals have no integer row version; use the persisted updatedAt millisecond token returned by the empty-lines read.
  if (expectedVersion !== undefined) assertRowVersion({ entity: "removal", id: removal.id, expectedVersion, actualVersion: removal.updatedAt.getTime() });
  return { ...context, memberBatches: [...new Map(members.map(({ batch }) => [batch.id, batch])).values()] };
}

export async function recordEmissionZeros(ctx: OrgContext, input: z.input<typeof recordEmissionZerosSchema>) {
  requireOrgScope(ctx);
  const data = recordEmissionZerosSchema.parse(input);
  return db.transaction(async (tx) => {
    const { batch, observation, memberBatches } = await lockZeroDraft(ctx, tx, data, data.expectedRemovalVersion);
    const memberBatchIds = memberBatches.map((member) => member.id);
    const entryFacts = Object.fromEntries(await Promise.all(memberBatchIds.map(async (id) =>
      [id, await loadBatchEmissionEntryFacts(ctx, id, observation, tx)] as const)));
    const entries = entryFacts[batch.id].entries;
    const contenders = await listEmissionEntryDraftContenders(ctx, memberBatchIds, tx);
    // Existing confirmations stay idempotent; derive eligibility without this draft's zeros.
    const candidates = Object.values(entryFacts).flatMap((facts) => facts.entries)
      .filter((entry) => !(entry.kind === "zero" && entry.confirmedForRemovalId === data.removalId));
    const reservations = await loadEmissionEntryReservations(ctx, candidates.flatMap((entry) => entry.sendReservedBySubmissionId ? [entry.sendReservedBySubmissionId] : []), tx);
    const automatic = await loadBatchesEmissionAutomaticFacts(ctx, memberBatchIds, {}, tx);
    const availableApplications = await listEmissionEntryAvailableApplications(ctx, memberBatchIds, tx);
    const nowMs = Date.now();
    const orphanIds = entriesWithoutRemoval(candidates, contenders, new Set(reservations.filter((row) => isLiveEntryReservation(row, nowMs)).map((row) => row.submissionId)), availableApplications);
    const contributions = deriveRemovalEntryInputs({
      removalId: data.removalId, memberBatchIds, window: contenders.find((row) => row.removalId === data.removalId)?.window ?? null,
      contenders, entries: candidates, entriesWithoutRemoval: orphanIds, observation, reservations, nowMs,
    });
    const problems = validateLineSources(observation.definition, observation.lineSources);
    const { emptyLinesByBatchId } = deriveRemovalEmissionLines(Object.fromEntries(memberBatches.map((member) => [member.id, {
      definition: observation.definition, lineSources: observation.lineSources, problems,
      enrichmentComplete: isEnrichmentComplete(observation.definition, observation.enrichment),
      automaticFigures: automatic[member.id].automaticFigures,
      omittedAutomaticSources: omittedProductionSources(member.productionEmissionsClaimedByRemovalId, data.removalId),
      entries: candidates.filter((entry) => entry.creditBatchId === member.id),
      previousObservations: entryFacts[member.id].previousObservations, entriesWithoutRemoval: orphanIds,
    }])), contributions);
    const saved = [];
    for (const componentId of [...new Set(data.componentIds)].sort()) {
      const line = entryLine(observation, componentId);
      if (!line || line.contract.scope !== "operating" || line.entryPolicy === "none" || problems.some((problem) => problem.componentId === componentId)) {
        throw new SafeError("This component does not take manual entries. Review its setup.");
      }
      if (!emptyLinesByBatchId[batch.id].some((line) => line.componentId === componentId)) {
        throw new SafeError("Only empty components can be recorded as zero for this Removal.");
      }
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
    if (saved.some((id) => !entries.some((entry) => entry.id === id))) await touchZeroReviewVersion(ctx, tx, data.removalId);
    return { entryIds: saved };
  });
}

export async function undoEmissionZeros(ctx: OrgContext, input: z.input<typeof undoEmissionZerosSchema>) {
  requireOrgScope(ctx);
  const data = undoEmissionZerosSchema.parse(input);
  return db.transaction(async (tx) => {
    await lockZeroDraft(ctx, tx, data, data.expectedRemovalVersion);
    const rows = await tx.select().from(emissionEntries).where(and(eq(emissionEntries.organizationId, ctx.organizationId),
      eq(emissionEntries.creditBatchId, data.creditBatchId), eq(emissionEntries.confirmedForRemovalId, data.removalId), isNull(emissionEntries.deletedAt),
    )).orderBy(emissionEntries.id).for("update");
    if (rows.some((entry) => entry.sendReservedBySubmissionId || (entry.sentByRemovalId && !emissionCorrectionWindow(ctx, tx, entry.creditBatchId, entry.sentByRemovalId)))) throw new SafeError("These recorded zeros are reserved or sent. They cannot be changed.");
    for (const row of rows) {
      const [saved] = await tx.update(emissionEntries).set({ deletedAt: sql`now()`, updatedAt: sql`now()`,
        version: nextVersion(emissionEntries.version), contentRevision: nextVersion(emissionEntries.contentRevision),
      }).where(and(eq(emissionEntries.organizationId, ctx.organizationId), eq(emissionEntries.id, row.id))).returning();
      await recordEmissionEntryActivity(ctx, tx, "deleted", { ...row, values: [] }, { ...saved, values: [] });
    }
    if (rows.length) await touchZeroReviewVersion(ctx, tx, data.removalId);
    return { entryIds: rows.map((row) => row.id) };
  });
}

/** Advance the millisecond review token when zero confirmations change. */
async function touchZeroReviewVersion(ctx: OrgContext, tx: DbTransaction, removalId: string) {
  requireOrgScope(ctx);
  await tx.update(certifierRemovals).set({
    updatedAt: sql`greatest(date_trunc('milliseconds', clock_timestamp()), ${certifierRemovals.updatedAt} + interval '1 millisecond')`,
  }).where(and(eq(certifierRemovals.organizationId, ctx.organizationId), eq(certifierRemovals.id, removalId)));
}
