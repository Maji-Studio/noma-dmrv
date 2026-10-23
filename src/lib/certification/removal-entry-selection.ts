import { isCarriedToRemoval } from "./emission-entry-carry";
import { emissionEntryCounts, entryLine, type EntryObservation } from "./emission-entry-rules";
import { EMISSION_ENTRIES_CHANGED } from "./emission-entry-messages";
import { deriveRemovalEntryWindow, entryHoldingRemovalId, entriesWithoutRemoval, isLiveEntryReservation, type RemovalEntryFact } from "./removal-emission-contributions";
import { deriveRemovalEntryInputs } from "./removal-entry-inputs";

type Input = Parameters<typeof deriveRemovalEntryInputs>[0];
type CarriedEntry = RemovalEntryFact & {
  creditBatchCode: string; entryObservation: EntryObservation;
  earlierRemovalCode?: string; earlierRemovalId?: string;
};

/** Pure shared selection; callers load only the returned reservation IDs. */
export function selectRemovalEntries(args: {
  removalId: string;
  memberBatches: readonly { id: string; code: string; startDate: string }[];
  applicationDates: readonly (Date | string)[];
  observation: EntryObservation;
  ownEntries: readonly RemovalEntryFact[];
  carryEntries: readonly CarriedEntry[];
  frozenEntrySet?: { entryId: string; contentRevision: number }[];
  contenders: Input["contenders"];
  entriesWithoutRemoval?: string[];
  availableApplications?: Parameters<typeof entriesWithoutRemoval>[3];
}) {
  const { removalId, observation } = args;
  const memberIds = args.memberBatches.map(batch => batch.id);
  const carriedEntries = args.carryEntries.filter(entry => !memberIds.includes(entry.creditBatchId) && isCarriedToRemoval(entry, removalId))
    .map(entry => ({ ...entry, ...emissionEntryCounts(entry.entryObservation, observation, entry.componentId) }));
  const allEntries = [...args.ownEntries, ...carriedEntries];
  const frozenChanged = args.frozenEntrySet?.some(frozen => !allEntries.some(entry =>
    entry.id === frozen.entryId && entry.contentRevision === frozen.contentRevision && !entry.deletedAt));
  const frozen = frozenChanged ? undefined : args.frozenEntrySet;
  // Historical sent singles remain omission facts outside this attempt's frozen set.
  const belongsToFrozenView = (entry: RemovalEntryFact) => !frozen || frozen.some(item => item.entryId === entry.id) ||
    (entry.kind === "value" && entry.lineRule === "single" && !!entryHoldingRemovalId(entry) && entryHoldingRemovalId(entry) !== removalId);
  const entries = allEntries.filter(belongsToFrozenView);
  return {
    frozen, belongsToFrozenView,
    reservationIds: [...new Set(entries.flatMap(entry => entry.sendReservedBySubmissionId ? [entry.sendReservedBySubmissionId] : []))],
    derive(reservations: Input["reservations"], nowMs: number) {
      const contributions = deriveRemovalEntryInputs({ removalId, memberBatchIds: memberIds, observation,
        window: deriveRemovalEntryWindow(args.memberBatches, args.applicationDates),
        creditBatchCodes: Object.fromEntries([...args.memberBatches.map(batch => [batch.id, batch.code]),
          ...carriedEntries.map(entry => [entry.creditBatchId, entry.creditBatchCode])]),
        contenders: args.contenders, entries, reservations, nowMs, frozen: !!frozen,
        entriesWithoutRemoval: frozen ? [] : args.entriesWithoutRemoval ?? entriesWithoutRemoval(args.ownEntries, args.contenders,
          new Set(reservations.filter(row => isLiveEntryReservation(row, nowMs)).map(row => row.submissionId)), args.availableApplications ?? []),
      });
      contributions.carriedEntries = carriedEntries.filter(entry => contributions.selectedEntryIds.includes(entry.id)).map(entry => ({
        entryId: entry.id, creditBatchCode: entry.creditBatchCode, creditBatchId: entry.creditBatchId, occurredOn: entry.occurredOn,
        componentId: entry.componentId, componentName: entryLine(observation, entry.componentId)?.component.displayName,
        value: entry.values[0], evidenceDocumentIds: [...entry.evidenceDocumentIds].sort(),
        earlierRemovalCode: entry.earlierRemovalCode, earlierRemovalId: entry.earlierRemovalId,
      })).sort((a, b) => a.entryId.localeCompare(b.entryId));
      if (frozenChanged) contributions.blockers.push({ code: "lineNeedsReview", message: EMISSION_ENTRIES_CHANGED,
        fixTarget: "emissions", creditBatchId: args.memberBatches[0].id });
      return contributions;
    },
  };
}
