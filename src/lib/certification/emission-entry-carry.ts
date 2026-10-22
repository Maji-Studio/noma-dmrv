import { emissionEntryCounts, entryLine, type EntryObservation } from "./emission-entry-rules";
import { removalEntryOwner, type EntryContender, type RemovalEntryFact } from "./removal-emission-contributions";

export interface CarryContender extends EntryContender {
  organizationId: string;
  facilityId: string;
  code: string;
  creditBatchCodes: string[];
  observation: EntryObservation | null;
}
export const CARRY_WAITING_REASONS = {
  noDraft: "Waiting for a Removal. No later draft is available at this facility.",
  templateUnknown: "Waiting for a Removal. noma has not read the next draft's template yet. Open the Removal to load it.",
  incompatibleTemplate: "Waiting for a Removal. The next draft's template cannot take this component.",
} as const;
export type CarryWaitingReason = keyof typeof CARRY_WAITING_REASONS;
export interface EntryCarryDestination {
  removalId: string;
  removalCode: string;
  creditBatchCodes: string[];
  anotherCreditBatch: boolean;
}
export interface EntryCarryDisposition {
  receiver: EntryCarryDestination | null;
  waitingReason: CarryWaitingReason | null;
}

/** The skip-incompatible policy lives here so a later blocking policy changes one seam. */
export function removalEntryCarryOwner(args: {
  entry: RemovalEntryFact;
  organizationId: string;
  facilityId: string;
  fullyApplied: boolean;
  ownContenders: readonly EntryContender[];
  contenders: readonly CarryContender[];
  observation: EntryObservation | null;
}): EntryCarryDisposition {
  const { entry } = args;
  const none: EntryCarryDisposition = { receiver: null, waitingReason: null };
  if (entry.deletedAt || entry.kind !== "value" || entry.lineRule !== "additive" ||
    entry.values.length !== 1 ||
    !args.observation || entryLine(args.observation, entry.componentId)?.component.inputs.filter(input => input.type === "monitored").length !== 1 ||
    entry.sentByRemovalId || entry.heldForRemovalId || entry.reservedByRemovalId ||
    (entry.sendReservedBySubmissionId && !entry.reservationKnownInactive) ||
    !args.fullyApplied || removalEntryOwner(entry, args.ownContenders)) return none;
  const candidates = args.contenders.filter(candidate => candidate.contenderKind === "draft" &&
    candidate.organizationId === args.organizationId && candidate.facilityId === args.facilityId &&
    !candidate.creditBatchIds.includes(entry.creditBatchId) && candidate.window.end >= entry.occurredOn)
    .sort((a, b) => a.window.end.localeCompare(b.window.end) || a.createdAt.localeCompare(b.createdAt) || a.removalId.localeCompare(b.removalId));
  const receiver = candidates.find(candidate => {
    if (!args.observation || !candidate.observation) return false;
    const line = entryLine(candidate.observation, entry.componentId);
    return line?.entryPolicy === "additive" &&
      line.component.inputs.filter(input => input.type === "monitored").length === 1 &&
      emissionEntryCounts(args.observation, candidate.observation, entry.componentId).counts;
  });
  return receiver ? { receiver: { removalId: receiver.removalId, removalCode: receiver.code, creditBatchCodes: receiver.creditBatchCodes, anotherCreditBatch: true }, waitingReason: null }
    : { receiver: null, waitingReason: candidates.length ? candidates[0].observation ? "incompatibleTemplate" : "templateUnknown" : "noDraft" };
}
