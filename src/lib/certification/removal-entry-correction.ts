import type { EntryInputManifest } from "./removal-emission-contributions";

export interface EntryCorrectionState {
  removalId?: string;
  changedBatchIds?: string[];
  windowOpen: boolean;
  correctionNeeded: boolean;
  changedComponentIds: string[];
  message: string | null;
}

/** Display labels and ordering do not change the contribution; all sent facts do. */
export function deriveEntryCorrection(windowOpen: boolean, previous: readonly EntryInputManifest[], current: readonly EntryInputManifest[]): EntryCorrectionState {
  const signature = (manifest: readonly EntryInputManifest[], componentId: string) => JSON.stringify(
    manifest.filter((input) => input.componentId === componentId).map((input) => ({ inputKey: input.inputKey,
      entries: input.entries.map((entry) => ({ entryId: entry.entryId, contentRevision: entry.contentRevision,
        creditBatchId: entry.creditBatchId, occurredOn: entry.occurredOn, kind: entry.kind, value: { magnitude: entry.value.magnitude, unit: entry.value.unit },
        massDistanceDetail: entry.massDistanceDetail ? {
          mass: { magnitude: entry.massDistanceDetail.mass.magnitude, unit: entry.massDistanceDetail.mass.unit },
          distance: { magnitude: entry.massDistanceDetail.distance.magnitude, unit: entry.massDistanceDetail.distance.unit },
        } : null, evidenceDocumentIds: [...entry.evidenceDocumentIds].sort(),
      })).sort((a, b) => a.entryId.localeCompare(b.entryId)),
    })).sort((a, b) => a.inputKey.localeCompare(b.inputKey)),
  );
  const changedComponentIds = windowOpen ? [...new Set([...previous, ...current].map((input) => input.componentId))]
    .filter((id) => signature(previous, id) !== signature(current, id)).sort() : [];
  const batchIds = [...new Set([...previous, ...current].flatMap((input) => input.entries.map((entry) => entry.creditBatchId)))];
  const forBatch = (manifest: readonly EntryInputManifest[], batchId: string) => manifest
    .map((input) => ({ ...input, entries: input.entries.filter((entry) => entry.creditBatchId === batchId) }))
    .filter((input) => input.entries.length);
  const changedBatchIds = batchIds.filter((batchId) => changedComponentIds.some((id) =>
    signature(forBatch(previous, batchId), id) !== signature(forBatch(current, batchId), id))).sort();
  const count = changedComponentIds.length;
  return { windowOpen, correctionNeeded: count > 0, changedComponentIds, changedBatchIds,
    message: count ? `Correction needed: ${count} ${count === 1 ? "component" : "components"} changed since this Removal was sent.` : null };
}
