import { carriedEntrySnapshotSchema } from "@/lib/certification/carried-entry-snapshot";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { creditBatches } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";
import { SafeError } from "@/lib/errors";
import { type RemovalEntryContributions } from "@/lib/certification/removal-emission-contributions";
import { entryLine } from "@/lib/certification/emission-entry-rules";
import { requireOrgScope } from "./utils";
import { getCreditBatchesByRemovalId, getCertifierRemovalById } from "./certifier-removals";
import { getSentRemovalForComparison } from "./removal-entry-correction";
import { loadDraftRemovalCarriedEntries } from "./removal-draft-carried-entries";
import { getTemplateObservationById } from "./removal-template-observations";
import { getRemovalCodes } from "./removal-codes";
import { loadFacilityEmissionEntryCarry } from "./emission-entry-carry";
import { readRecordLockLineage } from "./record-lock-lineage";
import { readsAsReturnedFromPersisted } from "@/lib/record-lock";

export type RemovalCarriedEntry = NonNullable<RemovalEntryContributions["carriedEntries"]>[number];
export interface RemovalCarriedEntries { carriedEntries: RemovalCarriedEntry[]; lateEntries: RemovalCarriedEntry[] }
const snapshotSchema = z.object({
  templateObservationId: z.string().optional(),
  semantic: z.object({
    carriedEntries: z.array(carriedEntrySnapshotSchema).default([]),
  }),
});

/** Entry-only sheet read; sent values are frozen and only display labels are hydrated. */
export async function loadRemovalCarriedEntries(ctx: OrgContext, removalId: string): Promise<RemovalCarriedEntries> {
  requireOrgScope(ctx);
  const removal = await getCertifierRemovalById(ctx, removalId);
  if (!removal) throw new SafeError("Removal was not found.");
  const sent = await getSentRemovalForComparison(ctx, removalId);
  if (!sent) return { carriedEntries: await loadDraftRemovalCarriedEntries(ctx, removalId, removal.facilityId), lateEntries: [] };
  const parsed = snapshotSchema.safeParse(sent.payloadSnapshot);
  if (!parsed.success) throw new DomainError("validation_failed", "The sent Removal’s saved emissions entry set could not be read. Reload the Removal and try again.");
  const snapshot = parsed.data;
  const entries = snapshot.semantic.carriedEntries;
  const lateEntries = await loadRevisionLateEntries(ctx, removal);
  if (!entries.length) return { carriedEntries: [], lateEntries };
  const earlier = new Map(entries.map(entry => [entry.entryId, entry.earlierRemovalId]));
  const [batches, observation, codes] = await Promise.all([
    db.select({ id: creditBatches.id, code: creditBatches.code }).from(creditBatches).where(and(
      eq(creditBatches.organizationId, ctx.organizationId), eq(creditBatches.facilityId, removal.facilityId),
      inArray(creditBatches.id, [...new Set(entries.map(entry => entry.creditBatchId))]),
    )),
    snapshot.templateObservationId ? getTemplateObservationById(ctx, snapshot.templateObservationId) : null,
    getRemovalCodes(ctx, [...earlier.values()].filter((id): id is string => !!id)),
  ]);
  const carriedEntries = entries.map(entry => {
    const batch = batches.find(batch => batch.id === entry.creditBatchId);
    const earlierRemovalId = earlier.get(entry.entryId);
    return { entryId: entry.entryId, creditBatchId: entry.creditBatchId, creditBatchCode: batch?.code ?? entry.creditBatchId,
      componentId: entry.componentId, componentName: (observation ? entryLine(observation, entry.componentId)?.component.displayName : undefined),
      occurredOn: entry.occurredOn, value: entry.value, evidenceDocumentIds: [...entry.evidenceDocumentIds].sort(),
      earlierRemovalId, earlierRemovalCode: earlierRemovalId ? codes.get(earlierRemovalId) : undefined,
    };
  }).sort((a, b) => a.entryId.localeCompare(b.entryId));
  return { carriedEntries, lateEntries };
}

/** Live late entries keep their own observation's labels, beside the frozen sent list. */
async function loadRevisionLateEntries(ctx: OrgContext, removal: { id: string; facilityId: string; ghgStatementId: string | null }): Promise<RemovalCarriedEntry[]> {
  requireOrgScope(ctx);
  const { id: removalId, facilityId } = removal;
  // Facility discovery only for a returned Removal; every other sent sheet stays a snapshot read.
  const [lineage] = await readRecordLockLineage(ctx, db, [{ removalId, ghgStatementId: removal.ghgStatementId }]);
  if (!lineage || !readsAsReturnedFromPersisted(lineage)) return [];
  const members = await getCreditBatchesByRemovalId(ctx, removalId);
  const memberIds = members.map(batch => batch.id);
  if (!memberIds.length) return [];
  const carry = await loadFacilityEmissionEntryCarry(ctx, facilityId, undefined, undefined, { ownedBatchIds: memberIds });
  return carry.entries.flatMap(entry => entry.revisionOf?.removalId === removalId && memberIds.includes(entry.creditBatchId) && entry.total
    ? [{ entryId: entry.id, creditBatchId: entry.creditBatchId, creditBatchCode: entry.creditBatchCode,
      componentId: entry.componentId, componentName: entryLine(entry.entryObservation, entry.componentId)?.component.displayName,
      occurredOn: entry.occurredOn, value: entry.total, evidenceDocumentIds: [...entry.evidenceDocumentIds].sort(),
      earlierRemovalId: entry.earlierRemovalId, earlierRemovalCode: entry.earlierRemovalCode }] : [])
    .sort((a, b) => a.entryId.localeCompare(b.entryId));
}
