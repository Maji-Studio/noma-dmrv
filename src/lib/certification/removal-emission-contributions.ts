import { ENTRY_HAS_NO_REMOVAL } from "@/lib/certification/emission-entry-messages";
import { formatUtcDate } from "@/lib/date-utils";
import { LOCK_TTL_MS } from "@/lib/isometric/utils/lock";
import { getMetadataValue, SUBMISSION_METADATA_KEYS, SUBMISSION_EXTERNAL_MUTATIONS } from "./submission-metadata";
import { effectiveContract, type LineSources } from "@/lib/isometric/template-observations/line-sources";
import { canonicalDecimal } from "@/lib/isometric/template-observations/units";
import { sumFigures, type EmissionFigure } from "./emission-lines";
import type { RemovalBlocker } from "./removal-blockers";

export interface RemovalEntryWindow { start: string; end: string }
/** Applications are calendar dates persisted at UTC midnight, never facility instants. */
export function deriveRemovalEntryWindow(
  memberBatches: readonly { startDate: string }[], applicationDates: readonly (Date | string)[],
): RemovalEntryWindow | null {
  const starts = memberBatches.map((batch) => batch.startDate).sort();
  const ends = applicationDates.map((date) => date instanceof Date ? formatUtcDate(date) : date).sort();
  if (!starts.length || !ends.length || starts[0] > ends[ends.length - 1]) return null;
  return { start: starts[0], end: ends[ends.length - 1] };
}
export interface EntryContender {
  contenderKind: "draft";
  removalId: string;
  createdAt: string;
  creditBatchIds: readonly string[];
  window: RemovalEntryWindow;
}
export interface RemovalEntryValue extends EmissionFigure {
  inputKey: string;
  massDistanceDetail?: { mass: EmissionFigure; distance: EmissionFigure } | null;
}
export interface RemovalEntryFact {
  id: string; creditBatchId: string; componentId: string; contentRevision: number;
  kind: "value" | "zero"; lineRule: "single" | "additive"; occurredOn: string;
  deletedAt: Date | string | null; sentByRemovalId: string | null;
  confirmedForRemovalId: string | null;
  sendReservedBySubmissionId: string | null;
  /** Resolved only for a live reservation ledger row. */
  reservedByRemovalId?: string | null;
  reservationKnownInactive?: boolean;
  counts: boolean; unitMismatch?: boolean; reason?: string | null;
  values: readonly RemovalEntryValue[]; evidenceDocumentIds: readonly string[];
}
export interface EntryInputManifest {
  componentId: string; inputKey: string; componentDisplayName?: string;
  entries: { entryId: string; creditBatchId: string; creditBatchCode?: string; occurredOn?: string; contentRevision: number; kind: "value" | "zero";
    value: EmissionFigure; massDistanceDetail?: RemovalEntryValue["massDistanceDetail"];
    evidenceDocumentIds: string[] }[];
}
export interface RemovalEntryContributions {
  manifest: EntryInputManifest[];
  inputs: { componentId: string; inputKey: string; value: EmissionFigure }[];
  entrySet: { entryId: string; contentRevision: number }[];
  selectedEntryIds: string[];
  ownedEntryIds?: string[];
  sentSingleComponentIds: string[];
  blockers: (RemovalBlocker & { creditBatchId: string })[];
}
/** Read-side ownership mirrors the production reservation transfer rules; it never transfers a reservation. */
export function isLiveEntryReservation(row: {
  status: "draft" | "submitted" | "accepted" | "rejected" | "superseded";
  lockedAt: Date | null; metadata: unknown;
}, nowMs: number): boolean {
  const mutation = getMetadataValue(row.metadata, SUBMISSION_METADATA_KEYS.externalMutation);
  if (mutation === SUBMISSION_EXTERNAL_MUTATIONS.possible || mutation === SUBMISSION_EXTERNAL_MUTATIONS.confirmed) return true;
  if (row.status === "rejected" || row.status === "superseded") return false;
  if (row.status !== "draft") return true;
  return nowMs - (row.lockedAt?.getTime() ?? 0) < LOCK_TTL_MS;
}
function inWindow(entry: RemovalEntryFact, window: RemovalEntryWindow) {
  return entry.occurredOn >= window.start && entry.occurredOn <= window.end;
}
export function removalEntryOwner(entry: RemovalEntryFact, contenders: readonly EntryContender[]): string | null {
  if (entry.deletedAt) return null;
  if (entry.sentByRemovalId) return entry.sentByRemovalId;
  if (entry.reservedByRemovalId) return entry.reservedByRemovalId;
  if (entry.sendReservedBySubmissionId && !entry.reservationKnownInactive) return null;
  return contenders.filter((draft) => draft.creditBatchIds.includes(entry.creditBatchId) && inWindow(entry, draft.window) &&
    (entry.kind !== "zero" || entry.confirmedForRemovalId === draft.removalId))
    .sort((a, b) => a.window.end.localeCompare(b.window.end) || a.createdAt.localeCompare(b.createdAt) || a.removalId.localeCompare(b.removalId))[0]?.removalId ?? null;
}

/** Shared by batch reads and the transactional zero writer. */
export function entriesWithoutRemoval(
  entries: readonly RemovalEntryFact[], contenders: readonly EntryContender[], liveReservationIds: ReadonlySet<string>,
  applications: readonly { creditBatchId: string; applicationDate: Date }[],
): string[] {
  return entries.filter((entry) => entry.kind === "value" && !entry.sentByRemovalId &&
    !liveReservationIds.has(entry.sendReservedBySubmissionId ?? "") &&
    !removalEntryOwner({ ...entry, reservationKnownInactive: true }, contenders) &&
    !applications.some((application) => application.creditBatchId === entry.creditBatchId &&
      formatUtcDate(application.applicationDate) >= entry.occurredOn)).map((entry) => entry.id);
}

/** Select whole entries before reducing inputs, so paired measurements never cross entries. */
export function deriveRemovalEntryContributions(args: {
  removalId: string; memberBatchIds: readonly string[]; window: RemovalEntryWindow | null;
  contenders: readonly EntryContender[]; entries: readonly RemovalEntryFact[]; lineSources: LineSources;
  entriesWithoutRemoval?: readonly string[];
  creditBatchCodes?: Readonly<Record<string, string>>;
  monitoredInputs: readonly { componentId: string; inputKey: string; unit: string; componentDisplayName?: string }[];
}): RemovalEntryContributions {
  const result: RemovalEntryContributions = { manifest: [], inputs: [], entrySet: [], selectedEntryIds: [], ownedEntryIds: [], sentSingleComponentIds: [], blockers: [] };
  const relevant = args.entries.filter((entry) => !entry.deletedAt && args.memberBatchIds.includes(entry.creditBatchId));
  const selected: RemovalEntryFact[] = [];
  for (const entry of relevant) {
    const owner = removalEntryOwner(entry, args.contenders);
    const owned = owner === args.removalId && !!args.window && inWindow(entry, args.window) &&
      (entry.kind !== "zero" || entry.confirmedForRemovalId === args.removalId);
    if (owned) result.ownedEntryIds!.push(entry.id);
    const stored = args.lineSources[entry.componentId];
    const contract = stored && effectiveContract(stored);
    if (contract?.scope !== "operating" || contract.entryPolicy === "none") continue;
    if (!owner && entry.kind === "value" && (args.entriesWithoutRemoval?.includes(entry.id) ?? true)) result.blockers.push({
      code: "entryHasNoRemoval", message: ENTRY_HAS_NO_REMOVAL, fixTarget: "emissions", creditBatchId: entry.creditBatchId,
      lineRef: { componentId: entry.componentId, displayName: entry.componentId },
    });
    if (entry.kind === "value" && entry.lineRule === "single" && entry.sentByRemovalId && entry.sentByRemovalId !== args.removalId) {
      result.sentSingleComponentIds.push(entry.componentId);
      continue;
    }
    if (!owned) continue;
    if (!entry.counts || entry.unitMismatch) {
      result.blockers.push({ code: "lineNeedsReview", message: entry.reason ?? "Enter the values again for the current component.", fixTarget: "emissions", creditBatchId: entry.creditBatchId, lineRef: { componentId: entry.componentId, displayName: entry.componentId } });
      continue;
    }
    if (entry.kind === "value" && !entry.evidenceDocumentIds.length) result.blockers.push({ code: "entryMissingEvidence", message: "Add a file for each emissions entry with a value.", fixTarget: "emissions", creditBatchId: entry.creditBatchId, lineRef: { componentId: entry.componentId, displayName: entry.componentId } });
    selected.push(entry);
  }
  const components = [...new Set(selected.map((entry) => entry.componentId))].sort();
  for (const componentId of components) {
    const entries = selected.filter((entry) => entry.componentId === componentId).sort((a, b) => a.id.localeCompare(b.id));
    const values = entries.filter((entry) => entry.kind === "value");
    if (args.lineSources[componentId].entryPolicy === "single" && values.length > 1) {
      result.blockers.push({ code: "singleLineMultipleEntries", message: "This component has values on more than one credit batch. Create separate Removals for these batches.", fixTarget: "emissions", creditBatchId: values[0].creditBatchId, lineRef: { componentId, displayName: componentId } });
      continue;
    }
    // A value supersedes that batch's zero, even if a caller supplied stale facts.
    const counting = entries.filter((entry) => entry.kind === "value" || !values.some((value) => value.creditBatchId === entry.creditBatchId));
    for (const input of args.monitoredInputs.filter((input) => input.componentId === componentId).sort((a, b) => a.inputKey.localeCompare(b.inputKey))) {
      const manifest: EntryInputManifest = { componentId, inputKey: input.inputKey,
        ...(input.componentDisplayName ? { componentDisplayName: input.componentDisplayName } : {}), entries: [] };
      for (const entry of counting) {
        const value = entry.kind === "zero" ? { magnitude: "0", unit: input.unit } : entry.values.find((value) => value.inputKey === input.inputKey);
        if (!value || value.unit !== input.unit || canonicalDecimal(value.magnitude) === undefined) {
          result.blockers.push({ code: "lineNeedsReview", message: "Enter the values again for the current component.", fixTarget: "emissions", creditBatchId: entry.creditBatchId, lineRef: { componentId: entry.componentId, displayName: entry.componentId } });
          continue;
        }
        manifest.entries.push({ entryId: entry.id, creditBatchId: entry.creditBatchId, occurredOn: entry.occurredOn,
          ...(args.creditBatchCodes?.[entry.creditBatchId] ? { creditBatchCode: args.creditBatchCodes[entry.creditBatchId] } : {}), contentRevision: entry.contentRevision, kind: entry.kind,
          value: { magnitude: canonicalDecimal(value.magnitude)!, unit: value.unit },
          ...("massDistanceDetail" in value && value.massDistanceDetail ? { massDistanceDetail: value.massDistanceDetail } : {}),
          evidenceDocumentIds: entry.kind === "zero" ? [] : [...entry.evidenceDocumentIds].sort() });
      }
      if (manifest.entries.length) {
        result.manifest.push(manifest);
        result.inputs.push({ componentId, inputKey: input.inputKey, value: sumFigures(manifest.entries.map((entry) => entry.value))! });
      }
    }
    for (const entry of counting) {
      result.entrySet.push({ entryId: entry.id, contentRevision: entry.contentRevision });
      result.selectedEntryIds.push(entry.id);
    }
  }
  result.entrySet.sort((a, b) => a.entryId.localeCompare(b.entryId));
  result.sentSingleComponentIds = [...new Set(result.sentSingleComponentIds)].filter((id) => !components.includes(id)).sort();
  return result;
}
