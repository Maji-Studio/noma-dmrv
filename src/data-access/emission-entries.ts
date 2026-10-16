import { loadBatchAutomaticFigures } from "./batch-emission-automatic-figures";
import { loadBatchEmissionEntryFacts } from "./emission-entry-facts";
import { entryLine, resolveEmissionEntryDate, validateOperatorZero, validateEntryDate, normalizeNothingToRecordNote } from "@/lib/certification/emission-entry-rules";
import { markNothingToRecordSchema, type MarkNothingToRecordInput } from "@/schemas/emission-entries";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import {
  emissionEntries,
  emissionEntryValues,
  documents,
  certificationSubmissions,
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { resolveBatchPin } from "@/lib/certification/resolve-batch-pin";
import { REMOVAL_TEMPLATE_BLOCKERS } from "@/lib/certification/removal-template-blockers";
import { getLatestTemplateObservation, getTemplateObservationById } from "./removal-template-observations";
import { SafeError } from "@/lib/errors";
import { requireEmissionsEntriesEnabled } from "@/lib/certification/emissions-entry-gate";
import {
  emissionEntryCounts,
  normalizedEntryValues,
  validateEmissionEntry,
  type EntryValueInput,
} from "@/lib/certification/emission-entry-rules";
import {
  createEmissionEntrySchema,
  updateEmissionEntrySchema,
  type CreateEmissionEntryInput,
  type UpdateEmissionEntryInput,
} from "@/schemas/emission-entries";
import { requireOrgScope, type Executor } from "./utils";
import { assertRowVersion, nextVersion } from "./row-version";
import { lockWritableEmissionEntry, lockEmissionEntryBatch, emissionEntryParentChanged } from "./emission-entry-lock";
import { recordEmissionEntryActivity } from "./emission-entry-activity";

export async function getEmissionEntry(ctx: OrgContext, id: string, executor: Executor = db) {
  requireOrgScope(ctx);
  const [entry] = await executor
    .select()
    .from(emissionEntries)
    .where(
      and(
        eq(emissionEntries.organizationId, ctx.organizationId),
        eq(emissionEntries.id, id),
        isNull(emissionEntries.deletedAt),
      ),
    );
  if (!entry) throw new SafeError("Emissions entry was not found.");
  const values = await executor
    .select()
    .from(emissionEntryValues)
    .where(
      and(eq(emissionEntryValues.organizationId, ctx.organizationId), eq(emissionEntryValues.entryId, id)),
    )
    .orderBy(asc(emissionEntryValues.inputKey));
  const [{ count }] = await executor
    .select({ count: sql<number>`count(*)::int` })
    .from(documents)
    .where(
      and(
        eq(documents.organizationId, ctx.organizationId),
        eq(documents.entityType, "emission_entry"),
        eq(documents.entityId, id),
        eq(documents.uploadStatus, "uploaded"),
      ),
    );
  return { ...entry, values, documentCount: count };
}
export async function listEmissionEntries(ctx: OrgContext, creditBatchId: string, executor: Executor = db) {
  requireOrgScope(ctx);
  return listEmissionEntriesForBatches(ctx, [creditBatchId], executor);
}

/** Three set-based reads, independent of batch and entry counts. */
export async function listEmissionEntriesForBatches(
  ctx: OrgContext, creditBatchIds: string[], executor: Executor = db,
) {
  requireOrgScope(ctx);
  if (!creditBatchIds.length) return [];
  const entries = await executor
    .select()
    .from(emissionEntries)
    .where(
      and(
        eq(emissionEntries.organizationId, ctx.organizationId),
        inArray(emissionEntries.creditBatchId, creditBatchIds),
        isNull(emissionEntries.deletedAt),
      ),
    )
    .orderBy(asc(emissionEntries.occurredOn), asc(emissionEntries.id));
  if (!entries.length) return [];
  const ids = entries.map((entry) => entry.id);
  const values = await executor
    .select()
    .from(emissionEntryValues)
    .where(
      and(
        eq(emissionEntryValues.organizationId, ctx.organizationId),
        inArray(emissionEntryValues.entryId, ids),
      ),
    )
    .orderBy(asc(emissionEntryValues.inputKey));
  const counts = await executor
    .select({ entryId: documents.entityId, count: sql<number>`count(*)::int` })
    .from(documents)
    .where(
      and(
        eq(documents.organizationId, ctx.organizationId),
        eq(documents.entityType, "emission_entry"),
        inArray(documents.entityId, ids),
        eq(documents.uploadStatus, "uploaded"),
      ),
    )
    .groupBy(documents.entityId);
  const valuesByEntry = new Map<string, typeof values>();
  for (const value of values) {
    const group = valuesByEntry.get(value.entryId) ?? [];
    group.push(value);
    valuesByEntry.set(value.entryId, group);
  }
  const countsByEntry = new Map(counts.map((row) => [row.entryId, row.count]));
  return entries.map((entry) => ({
    ...entry,
    values: valuesByEntry.get(entry.id) ?? [],
    documentCount: countsByEntry.get(entry.id) ?? 0,
  }));
}
async function lockedBatch(
  ctx: OrgContext,
  tx: DbTransaction,
  creditBatchId: string,
  fallbackObservationId?: string,
) {
  requireOrgScope(ctx);
  const { batch, facility } = await lockEmissionEntryBatch(ctx, tx, creditBatchId);
  if (batch.archivedAt) throw new SafeError("Credit batch was not found.");
  if (facility.archivedAt) throw new SafeError("Facility was not found.");
  const pin = resolveBatchPin([batch]);
  if ("code" in pin) throw new SafeError(REMOVAL_TEMPLATE_BLOCKERS[pin.code]);
  const observation = await getLatestTemplateObservation(ctx, "isometric", pin.pin, tx);
  const fallback = !observation && fallbackObservationId
    ? await getTemplateObservationById(ctx, fallbackObservationId, tx)
    : null;
  const resolvedObservation = observation ?? fallback;
  if (!resolvedObservation)
    throw new SafeError("Read the credit batch's Removal template before adding entries.");
  return { batch, facility, observation: resolvedObservation };
}
async function writeValues(ctx: OrgContext, tx: DbTransaction, id: string, values: EntryValueInput[]) {
  requireOrgScope(ctx);
  await tx
    .delete(emissionEntryValues)
    .where(
      and(eq(emissionEntryValues.organizationId, ctx.organizationId), eq(emissionEntryValues.entryId, id)),
    );
  return tx
    .insert(emissionEntryValues)
    .values(
      normalizedEntryValues(values).map(({ inputKey, magnitude, unit, massDistanceDetail }) => ({
        organizationId: ctx.organizationId,
        entryId: id,
        inputKey,
        magnitude,
        unit,
        massDistanceDetail,
      })),
    )
    .returning();
}
/** A value invalidates every unsubmitted draft's confirmation for this line. */
export async function tombstoneEmissionZeros(
  ctx: OrgContext,
  tx: DbTransaction,
  entry: { creditBatchId: string; removalTemplateId: string; componentId: string },
) {
  requireOrgScope(ctx);
  const zeros = await tx.select().from(emissionEntries).where(and(
    eq(emissionEntries.organizationId, ctx.organizationId),
    eq(emissionEntries.creditBatchId, entry.creditBatchId),
    eq(emissionEntries.componentId, entry.componentId),
    eq(emissionEntries.kind, "zero"), isNull(emissionEntries.confirmedForRemovalId),
    isNull(emissionEntries.deletedAt),
  )).orderBy(asc(emissionEntries.id));
  for (const zero of zeros) {
    const locked = await lockWritableEmissionEntry(ctx, tx, zero.id);
    const { values } = await getEmissionEntry(ctx, zero.id, tx);
    const before = { ...locked, values };
    const [after] = await tx.update(emissionEntries).set({
      deletedAt: new Date(), updatedAt: new Date(),
      version: nextVersion(emissionEntries.version),
      contentRevision: nextVersion(emissionEntries.contentRevision),
    }).where(and(eq(emissionEntries.organizationId, ctx.organizationId), eq(emissionEntries.id, zero.id))).returning();
    await recordEmissionEntryActivity(ctx, tx, "deleted", before, { ...after, values: before.values });
  }
  await tx
    .update(emissionEntries)
    .set({
      deletedAt: new Date(),
      updatedAt: new Date(),
      version: nextVersion(emissionEntries.version),
      contentRevision: nextVersion(emissionEntries.contentRevision),
    })
    .where(
      and(
        eq(emissionEntries.organizationId, ctx.organizationId),
        eq(emissionEntries.creditBatchId, entry.creditBatchId),
        eq(emissionEntries.removalTemplateId, entry.removalTemplateId),
        eq(emissionEntries.componentId, entry.componentId),
        eq(emissionEntries.kind, "zero"),
        sql`${emissionEntries.confirmedForRemovalId} is not null`,
        isNull(emissionEntries.deletedAt),
        isNull(emissionEntries.sentByRemovalId),
        isNull(emissionEntries.sendReservedBySubmissionId),
        sql`not exists (
          select 1 from ${certificationSubmissions}
          where ${certificationSubmissions.organizationId} = ${ctx.organizationId}
            and ${certificationSubmissions.localEntityId} = ${emissionEntries.confirmedForRemovalId}
            and ${certificationSubmissions.localEntityType} = 'removal'
            and (${certificationSubmissions.submittedAt} is not null
              or ${certificationSubmissions.status} in ('submitted', 'accepted'))
        )`,
      ),
    );
}
export async function createEmissionEntry(ctx: OrgContext, input: CreateEmissionEntryInput) {
  requireOrgScope(ctx);
  requireEmissionsEntriesEnabled();
  const data = createEmissionEntrySchema.parse(input);
  return db.transaction(async (tx) => {
    const { batch, facility, observation } = await lockedBatch(ctx, tx, data.creditBatchId);
    const active = await tx
      .select({ id: emissionEntries.id })
      .from(emissionEntries)
      .where(
        and(
          eq(emissionEntries.organizationId, ctx.organizationId),
          eq(emissionEntries.creditBatchId, batch.id),
          eq(emissionEntries.removalTemplateId, observation.externalTemplateId),
          eq(emissionEntries.componentId, data.componentId),
          eq(emissionEntries.kind, "value"),
          isNull(emissionEntries.deletedAt),
        ),
      );
    const entryPolicy = entryLine(observation, data.componentId)?.entryPolicy ?? "none";
    const occurredOn = resolveEmissionEntryDate({
      entryPolicy,
      occurredOn: data.occurredOn, batchStartDate: batch.startDate,
      batchEndDate: batch.endDate, timezone: facility.timezone,
    });
    const binding = validateEmissionEntry({
      ...data,
      occurredOn,
      dateDefaulted: entryPolicy === "single" || data.occurredOn === undefined,
      observation,
      batchStartDate: batch.startDate,
      timezone: facility.timezone,
      activeValueCount: active.length,
    });
    const [entry] = await tx
      .insert(emissionEntries)
      .values({
        organizationId: ctx.organizationId,
        creditBatchId: batch.id,
        removalTemplateId: observation.externalTemplateId,
        observationId: observation.id,
        componentId: data.componentId,
        ...binding,
        kind: "value",
        occurredOn,
        note: data.note,
        createdBy: ctx.userId,
      })
      .returning();
    const values = await writeValues(ctx, tx, entry.id, data.values);
    await tombstoneEmissionZeros(ctx, tx, entry);
    await recordEmissionEntryActivity(ctx, tx, "created", null, { ...entry, values });
    return getEmissionEntry(ctx, entry.id, tx);
  });
}
export async function updateEmissionEntry(ctx: OrgContext, input: UpdateEmissionEntryInput) {
  requireOrgScope(ctx);
  requireEmissionsEntriesEnabled();
  const data = updateEmissionEntrySchema.parse(input);
  return mutateEntry(ctx, data.id, data.expectedVersion, async (tx, entry, context) => {
    // A single-line date is fixed, including when a client still sends its date field.
    if (entry.lineRule === "single") data.occurredOn = undefined;
    if (entry.kind === "zero") {
      if (data.values) throw new SafeError("Recorded zeros do not have values. Add an entry instead.");
      if (data.note !== undefined) data.note = normalizeNothingToRecordNote(data.note);
      validateEntryDate({ occurredOn: data.occurredOn ?? entry.occurredOn,
        batchStartDate: context.batch.startDate, timezone: context.facility.timezone,
        dateDefaulted: data.occurredOn === undefined });
    }
    if (entry.kind === "value" && (data.values || data.occurredOn)) {
      const values =
        data.values ??
        entry.values.map((value) => ({
          ...value,
          quantityKind: entry.inputShape.find((input) => input.key === value.inputKey)!.quantityKind,
        }));
      const previous = await getTemplateObservationById(ctx, entry.observationId, tx);
      if (!previous || !emissionEntryCounts(previous, context.observation, entry.componentId).counts)
        throw new SafeError("Review the template change before editing this entry's values or date.");
      validateEmissionEntry({
        observation: context.observation,
        componentId: entry.componentId,
        values,
        occurredOn: data.occurredOn ?? entry.occurredOn,
        batchStartDate: context.batch.startDate,
        timezone: context.facility.timezone,
        activeValueCount: 0,
        dateDefaulted: data.occurredOn === undefined,
      });
    }
    const contentChanged =
      (data.occurredOn !== undefined && data.occurredOn !== entry.occurredOn) ||
      (data.values !== undefined &&
        JSON.stringify(normalizedEntryValues(data.values)) !==
          JSON.stringify(normalizedEntryValues(entry.values)));
    const values = data.values ? await writeValues(ctx, tx, entry.id, data.values) : entry.values;
    const [saved] = await tx
      .update(emissionEntries)
      .set({
        ...(data.occurredOn !== undefined ? { occurredOn: data.occurredOn } : {}),
        ...(data.note !== undefined ? { note: data.note } : {}),
        version: nextVersion(emissionEntries.version),
        ...(contentChanged ? { contentRevision: nextVersion(emissionEntries.contentRevision) } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(emissionEntries.organizationId, ctx.organizationId), eq(emissionEntries.id, entry.id)))
      .returning();
    await recordEmissionEntryActivity(ctx, tx, "updated", entry, { ...saved, values });
    return getEmissionEntry(ctx, entry.id, tx);
  });
}
async function mutateEntry<T>(
  ctx: OrgContext,
  id: string,
  expectedVersion: number,
  write: (
    tx: DbTransaction,
    entry: Omit<Awaited<ReturnType<typeof getEmissionEntry>>, "documentCount">,
    context: Awaited<ReturnType<typeof lockedBatch>>,
  ) => Promise<T>,
  deleting = false,
) {
  requireOrgScope(ctx);
  return db.transaction(async (tx) => {
    const initial = await getEmissionEntry(ctx, id, tx);
    // Facility, batch, then entry, including confirmation and deletion. No lineage guard applies.
    const context = await lockedBatch(
      ctx,
      tx,
      initial.creditBatchId,
      deleting ? initial.observationId : undefined,
    );
    const locked = await lockWritableEmissionEntry(ctx, tx, id);
    if (locked.creditBatchId !== initial.creditBatchId) throw emissionEntryParentChanged();
    assertRowVersion({ entity: "emission_entry", id, expectedVersion, actualVersion: locked.version });
    if (locked.kind === "zero" && locked.confirmedForRemovalId !== null)
      throw new SafeError("Recorded zeros can only be changed through their Removal.");
    const { values } = await getEmissionEntry(ctx, id, tx);
    return write(tx, { ...locked, values }, context);
  });
}
export async function confirmEmissionEntry(ctx: OrgContext, id: string, expectedVersion: number) {
  requireOrgScope(ctx);
  requireEmissionsEntriesEnabled();
  return mutateEntry(ctx, id, expectedVersion, async (tx, entry, { observation }) => {
    const previous = await getTemplateObservationById(ctx, entry.observationId, tx);
    if (!previous || !emissionEntryCounts(previous, observation, entry.componentId).canConfirm)
      throw new SafeError("This entry no longer matches the template. Enter the values again.");
    const [saved] = await tx
      .update(emissionEntries)
      .set({
        observationId: observation.id,
        version: nextVersion(emissionEntries.version),
        contentRevision: nextVersion(emissionEntries.contentRevision),
        updatedAt: new Date(),
      })
      .where(and(eq(emissionEntries.organizationId, ctx.organizationId), eq(emissionEntries.id, id)))
      .returning();
    if (entry.kind === "value") await tombstoneEmissionZeros(ctx, tx, saved);
    await recordEmissionEntryActivity(ctx, tx, "updated", entry, { ...saved, values: entry.values });
    return getEmissionEntry(ctx, id, tx);
  });
}
export async function deleteEmissionEntry(ctx: OrgContext, id: string, expectedVersion: number) {
  requireOrgScope(ctx);
  requireEmissionsEntriesEnabled();
  return mutateEntry(
    ctx,
    id,
    expectedVersion,
    async (tx, entry) => {
      const [saved] = await tx
        .update(emissionEntries)
        .set({
          deletedAt: new Date(),
          updatedAt: new Date(),
          version: nextVersion(emissionEntries.version),
          contentRevision: nextVersion(emissionEntries.contentRevision),
        })
        .where(and(eq(emissionEntries.organizationId, ctx.organizationId), eq(emissionEntries.id, id)))
        .returning();
      await recordEmissionEntryActivity(ctx, tx, "deleted", entry, { ...saved, values: entry.values });
      return { id };
    },
    true,
  );
}

/** The automatic read is server-owned and precedes the write transaction to avoid pool starvation. */
export async function markNothingToRecord(ctx: OrgContext, input: MarkNothingToRecordInput) {
  requireOrgScope(ctx);
  requireEmissionsEntriesEnabled();
  const data = markNothingToRecordSchema.parse(input);
  const automaticFigures = await loadBatchAutomaticFigures(ctx, data.facilityId, data.creditBatchId);
  return db.transaction(async (tx) => {
    const { batch, facility, observation } = await lockedBatch(ctx, tx, data.creditBatchId);
    if (batch.facilityId !== data.facilityId) throw emissionEntryParentChanged();
    const { entries } = await loadBatchEmissionEntryFacts(ctx, batch.id, observation, tx);
    const siblings = entries.filter((entry) => entry.componentId === data.componentId);
    const source = entryLine(observation, data.componentId)?.contract.automaticSource;
    const entryPolicy = entryLine(observation, data.componentId)?.entryPolicy ?? "none";
    const occurredOn = resolveEmissionEntryDate({
      entryPolicy,
      occurredOn: data.occurredOn, batchStartDate: batch.startDate,
      batchEndDate: batch.endDate, timezone: facility.timezone,
    });
    const binding = validateOperatorZero({ ...data, occurredOn, observation,
      dateDefaulted: entryPolicy === "single" || data.occurredOn === undefined,
      batchStartDate: batch.startDate, timezone: facility.timezone,
      activeValueCount: siblings.filter((entry) => entry.kind === "value" && entry.counts).length,
      activeOperatorZeroCount: siblings.filter((entry) => entry.kind === "zero" && !entry.confirmedForRemovalId).length,
      automaticFigure: source ? automaticFigures[source] ?? null : null,
    });
    const [entry] = await tx.insert(emissionEntries).values({
      organizationId: ctx.organizationId, creditBatchId: batch.id,
      removalTemplateId: observation.externalTemplateId, observationId: observation.id,
      componentId: data.componentId, kind: "zero", occurredOn, createdBy: ctx.userId, ...binding,
    }).returning();
    await recordEmissionEntryActivity(ctx, tx, "created", null, { ...entry, values: [] });
    return getEmissionEntry(ctx, entry.id, tx);
  });
}
