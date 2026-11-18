import { carriedEntrySnapshotSchema } from "@/lib/certification/carried-entry-snapshot";
import { z } from "zod";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";
import { SafeError } from "@/lib/errors";
import { entryLine } from "@/lib/certification/emission-entry-rules";
import { lateEntryFigures, type CarriedEntryRow } from "@/lib/certification/late-entry-figures";
import { getCreditBatchesByRemovalId, getCertifierRemovalById } from "@/data-access/certifier-removals";
import { getSentRemovalForComparison } from "@/data-access/removal-entry-correction";
import { loadDraftRemovalCarriedEntries } from "./removal-draft-carried-entries";
import { getTemplateObservationById } from "@/data-access/removal-template-observations";
import { getRemovalCodes } from "@/data-access/removal-codes";
import { loadFacilityEmissionEntryCarry } from "@/data-access/emission-entry-carry";
import { loadRecordLockLineage } from "@/data-access/record-lock-lineage";
import { getCreditBatchCodes } from "@/data-access/credit-batch-codes";
import { readsAsReturnedFromPersisted } from "@/lib/record-lock";

export type RemovalCarriedEntry = CarriedEntryRow;
export interface RemovalCarriedEntries { facilityId: string; carriedEntries: RemovalCarriedEntry[]; lateEntries: RemovalCarriedEntry[] }
const snapshotSchema = z.object({
  templateObservationId: z.string().optional(),
  semantic: z.object({
    carriedEntries: z.array(carriedEntrySnapshotSchema).default([]),
  }),
});

/** Entry-only sheet read; sent values are frozen and only display labels are hydrated. */
export async function loadRemovalCarriedEntries(ctx: OrgContext, removalId: string): Promise<RemovalCarriedEntries> {
  const removal = await getCertifierRemovalById(ctx, removalId);
  if (!removal) throw new SafeError("Removal was not found.");
  const sent = await getSentRemovalForComparison(ctx, removalId);
  if (!sent) return { facilityId: removal.facilityId, carriedEntries: await loadDraftRemovalCarriedEntries(ctx, removalId, removal.facilityId), lateEntries: [] };
  const parsed = snapshotSchema.safeParse(sent.payloadSnapshot);
  if (!parsed.success) throw new DomainError("validation_failed", "The sent Removal’s saved emissions entry set could not be read. Reload the Removal and try again.");
  const snapshot = parsed.data;
  const entries = snapshot.semantic.carriedEntries;
  const lateEntries = await loadRevisionLateEntries(ctx, removal);
  if (!entries.length) return { facilityId: removal.facilityId, carriedEntries: [], lateEntries };
  const earlier = new Map(entries.map(entry => [entry.entryId, entry.earlierRemovalId]));
  const [batches, observation, codes] = await Promise.all([
    getCreditBatchCodes(ctx, removal.facilityId, [...new Set(entries.map(entry => entry.creditBatchId))]),
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
  return { facilityId: removal.facilityId, carriedEntries, lateEntries };
}

/** Live late entries keep their own observation's labels, beside the frozen sent list. */
async function loadRevisionLateEntries(ctx: OrgContext, removal: { id: string; facilityId: string; ghgStatementId: string | null }): Promise<RemovalCarriedEntry[]> {
  const { id: removalId, facilityId } = removal;
  // Facility discovery only for a returned Removal; every other sent sheet stays a snapshot read.
  const [lineage] = await loadRecordLockLineage(ctx, [{ removalId, ghgStatementId: removal.ghgStatementId }]);
  if (!lineage || !readsAsReturnedFromPersisted(lineage)) return [];
  const members = await getCreditBatchesByRemovalId(ctx, removalId);
  const memberIds = members.map(batch => batch.id);
  if (!memberIds.length) return [];
  const carry = await loadFacilityEmissionEntryCarry(ctx, facilityId, undefined, undefined, { ownedBatchIds: memberIds });
  return carry.entries.flatMap(entry => {
    if (entry.revisionOf?.removalId !== removalId || !memberIds.includes(entry.creditBatchId)) return [];
    const figures = lateEntryFigures(entry);
    if (!figures) return [];
    return [{ entryId: entry.id, creditBatchId: entry.creditBatchId, creditBatchCode: entry.creditBatchCode,
      componentId: entry.componentId, componentName: entryLine(entry.entryObservation, entry.componentId)?.component.displayName,
      occurredOn: entry.occurredOn, ...figures, evidenceDocumentIds: [...entry.evidenceDocumentIds].sort(),
      earlierRemovalId: entry.earlierRemovalId, earlierRemovalCode: entry.earlierRemovalCode }];
  }).sort((a, b) => a.entryId.localeCompare(b.entryId));
}
