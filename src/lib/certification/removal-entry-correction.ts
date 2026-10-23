import type { EntryInputManifest } from "./removal-emission-contributions";

export type RemovalComparisonReason = "invalid_snapshot" | "missing_observation" | "invalid_compile" | "compile_refused";

export interface RemovalComparisonStatus {
  comparison?: "changed" | "unchanged" | "unavailable";
  unavailableReason?: RemovalComparisonReason;
  unavailableMessages?: string[];
}

export interface EntryCorrectionState extends RemovalComparisonStatus {
  removalId?: string;
  removalCode?: string;
  correction?: RemovalCorrection;
  changedPairs?: { componentId: string; batchId: string }[];
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
  const changedPairs = batchIds.sort().flatMap((batchId) => changedComponentIds
    .filter((id) => signature(forBatch(previous, batchId), id) !== signature(forBatch(current, batchId), id))
    .map((componentId) => ({ componentId, batchId })));
  const changedBatchIds = [...new Set(changedPairs.map((pair) => pair.batchId))];
  const count = changedComponentIds.length;
  return { windowOpen, correctionNeeded: count > 0, changedComponentIds, changedBatchIds, changedPairs,
    message: count ? `Resubmit needed: ${count} ${count === 1 ? "component" : "components"} changed since this Removal was sent.` : null };
}

export interface RemovalCorrection extends RemovalComparisonStatus {
  removalId: string;
  removalCode: string;
  windowOpen: boolean;
  resubmitNeeded: boolean;
  statement: {
    id: string;
    status: "FAILED_VERIFICATION" | "DRAFT";
    reportingPeriodStartOn: string | null;
    reportingPeriodEndOn: string;
  };
  batches: { id: string; code: string }[];
  changed: { componentId: string; componentName: string; batchId: string; batchCode: string }[];
}

/** Names are presentation facts; the comparison above intentionally ignores them. */
export function buildRemovalCorrection(args: {
  removalId: string;
  removalCode: string;
  state: EntryCorrectionState;
  statement: RemovalCorrection["statement"];
  batches: RemovalCorrection["batches"];
  components: readonly { id: string; displayName: string }[];
}): RemovalCorrection {
  return {
    removalId: args.removalId, removalCode: args.removalCode,
    windowOpen: args.state.windowOpen, resubmitNeeded: args.state.correctionNeeded,
    comparison: args.state.comparison, unavailableReason: args.state.unavailableReason,
    unavailableMessages: args.state.unavailableMessages,
    statement: args.statement, batches: args.batches,
    changed: (args.state.changedPairs ?? []).map(({ componentId, batchId }) => ({
      componentId, batchId,
      componentName: args.components.find((component) => component.id === componentId)?.displayName ?? componentId,
      batchCode: args.batches.find((batch) => batch.id === batchId)?.code ?? batchId,
    })),
  };
}

/** Reassemble the batch projections for a hub row without another correction read. */
export function correctionForRemoval(removalId: string, states: readonly EntryCorrectionState[]): RemovalCorrection | undefined {
  const corrections = states.flatMap((state) => state.correction?.removalId === removalId && state.correction.windowOpen
    ? [state.correction] : []);
  if (!corrections.length) return undefined;
  const changed = new Map(corrections.flatMap((correction) => correction.changed)
    .map((change) => [JSON.stringify([change.componentId, change.batchId]), change]));
  return { ...corrections[0], changed: [...changed.values()] };
}
