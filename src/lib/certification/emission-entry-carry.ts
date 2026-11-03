import { emissionEntryCounts, entryLine, type EntryObservation } from "./emission-entry-rules";
import { removalEntryOwner, type EntryContender, type RemovalEntryFact } from "./removal-emission-contributions";

/** The own-batch Removal whose revision will report a late entry. */
export interface EntryRevisionDestination { removalId: string; removalCode: string }

export interface CarryContender extends EntryContender {
  organizationId: string;
  facilityId: string;
  code: string;
  creditBatchCodes: string[];
  /** `creditBatchIds` (from EntryContender) lines up with these codes, so each can link to its batch. */
  observation: EntryObservation | null;
}
/** The unread-template wait: the fact, then the step that loads the template. */
export const TEMPLATE_UNKNOWN_COPY = {
  detail: "noma has not read the next draft's template yet.",
  instruction: "Open the Removal to load it.",
} as const;
export const CARRY_WAITING_DETAILS = {
  noDraft: "No later draft is available at this facility.",
  templateUnknown: `${TEMPLATE_UNKNOWN_COPY.detail} ${TEMPLATE_UNKNOWN_COPY.instruction}`,
  incompatibleTemplate: "The next draft's template cannot take this component.",
} as const;
export type CarryWaitingReason = keyof typeof CARRY_WAITING_DETAILS;
export const CARRY_WAITING_REASONS = Object.fromEntries(
  Object.entries(CARRY_WAITING_DETAILS).map(([reason, detail]) => [reason, `Waiting for a Removal. ${detail}`]),
) as Record<CarryWaitingReason, string>;
export interface EntryCarryDestination {
  removalId: string;
  removalCode: string;
  creditBatchCodes: string[];
  /** Aligned with `creditBatchCodes`. */
  creditBatchIds: string[];
  anotherCreditBatch: boolean;
}
export interface EntryCarryDisposition {
  receiver: EntryCarryDestination | null;
  waitingReason: CarryWaitingReason | null;
  /** The draft whose template is not read yet (`templateUnknown`), so the wait can open it. */
  waitingFor?: { removalId: string; removalCode: string } | null;
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
  for (const receiver of candidates) {
    if (!receiver.observation) return { receiver: null, waitingReason: "templateUnknown",
      waitingFor: { removalId: receiver.removalId, removalCode: receiver.code } };
    const line = entryLine(receiver.observation, entry.componentId);
    if (line?.entryPolicy === "additive" &&
      line.component.inputs.filter(input => input.type === "monitored").length === 1 &&
      emissionEntryCounts(args.observation, receiver.observation, entry.componentId).counts) {
      return { receiver: { removalId: receiver.removalId, removalCode: receiver.code, creditBatchCodes: receiver.creditBatchCodes,
        creditBatchIds: [...receiver.creditBatchIds], anotherCreditBatch: true }, waitingReason: null };
    }
  }
  return { receiver: null, waitingReason: candidates.length ? "incompatibleTemplate" : "noDraft", waitingFor: null };
}

/** The sent Removal of the entry's own batch, when the entry was recorded after it was sent. */
export function recordedAfter(carried: { earlierRemovalId?: string; earlierRemovalCode?: string } | undefined): { removalId: string; removalCode: string } | null {
  return carried?.earlierRemovalId && carried.earlierRemovalCode
    ? { removalId: carried.earlierRemovalId, removalCode: carried.earlierRemovalCode } : null;
}

/** A carry belongs to its elected, reserved, or sent Removal. */
export function isCarriedToRemoval(
  entry: Pick<RemovalEntryFact, "carry" | "reservedByRemovalId" | "sentByRemovalId">,
  removalId: string,
): boolean {
  return entry.carry?.receiver?.removalId === removalId ||
    entry.reservedByRemovalId === removalId || entry.sentByRemovalId === removalId;
}
