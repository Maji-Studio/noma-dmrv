import { frozenEntriesForAttempt } from "./frozen-removal-entries";
import { mergeEntryCarryFacts } from "./merge-entry-carry-facts";
import { selectRemovalEntries } from "./removal-entry-selection";

type SelectionArgs = Parameters<typeof selectRemovalEntries>[0];
type CarryEntries = SelectionArgs["carryEntries"] & Parameters<typeof mergeEntryCarryFacts>[1];

/** Assemble the narrow draft read into the shared entry pipeline without I/O. */
export function selectDraftRemovalEntries(args: {
  removalId: string;
  memberBatches: SelectionArgs["memberBatches"];
  readableBatchIds: readonly string[];
  observation: SelectionArgs["observation"];
  facts: readonly ({ entries: SelectionArgs["ownEntries"] } | null)[];
  carryEntries: CarryEntries;
  latest: Parameters<typeof frozenEntriesForAttempt>[0];
  contenders: SelectionArgs["contenders"];
  availableApplications: SelectionArgs["availableApplications"];
  rollups: Record<string, {
    batch: { productionEmissionsClaimReservedBySubmissionId?: string | null };
    lineageFacts: { applications: readonly { applicationDate: Date | string }[] };
  }>;
}) {
  const own = mergeEntryCarryFacts(args.facts.flatMap(fact => fact?.entries ?? []), args.carryEntries);
  const frozen = frozenEntriesForAttempt(args.latest, {
    carryContext: { entries: args.carryEntries },
    batchFacts: Object.fromEntries(args.readableBatchIds.map(id => [id, {
      entries: own.filter(entry => entry.creditBatchId === id),
      productionReservationSubmissionId: args.rollups[id]?.batch.productionEmissionsClaimReservedBySubmissionId,
    }])),
  });
  const selection = selectRemovalEntries({
    removalId: args.removalId, memberBatches: args.memberBatches, observation: args.observation,
    ownEntries: own, carryEntries: args.carryEntries, frozenEntrySet: frozen,
    contenders: args.contenders, availableApplications: args.availableApplications,
    applicationDates: Object.values(args.rollups).flatMap(rollup => rollup.lineageFacts.applications.map(application => application.applicationDate)),
  });
  return {
    reservationIds: selection.reservationIds,
    deriveCarriedEntries(reservations: Parameters<typeof selection.derive>[0], nowMs: number) {
      return selection.derive(reservations, nowMs).carriedEntries ?? [];
    },
  };
}
