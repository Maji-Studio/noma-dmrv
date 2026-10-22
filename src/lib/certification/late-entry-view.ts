/**
 * What an emissions entry recorded after its own batch's Removal was sent
 * shows (#1059): where it goes, and the one action that clears a wait. Pure,
 * so the entry row, the credit batch Overview and the to-do builder say the
 * same words.
 */
import { creditBatchDeepLinkHref } from "@/lib/credit-batch-links";
import { createIntentHref } from "@/lib/create-intent";
import { removalTemplatesSettingsHref } from "@/lib/certification/links";
import { formatDayString } from "@/lib/format-utils";
import { removalSheetHref } from "@/lib/removal-correction-copy";
import {
  CARRY_WAITING_REASONS,
  type CarryWaitingReason,
  type EntryCarryDestination,
  type EntryCarryDisposition,
} from "./emission-entry-carry";

const REMOVALS_PATH = "/certification/removals";
const WAITING_PREFIX = "Waiting for a Removal. ";

export interface LateEntryFacts {
  carry?: EntryCarryDisposition;
  reportedIn?: EntryCarryDestination | null;
  recordedAfter?: { removalId: string; removalCode: string } | null;
}

export interface LateEntryAction { label: string; href: string }

export interface LateEntryBatch { code: string; href: string }

export type LateEntryDestination =
  | { kind: "draft" | "reported"; removalCode: string; removalHref: string; creditBatches: LateEntryBatch[]; anotherCreditBatch: boolean }
  | { kind: "waiting"; reason: CarryWaitingReason; text: string; action: LateEntryAction };

export interface LateEntryView {
  recordedAfter: { removalCode: string; removalHref: string };
  destination: LateEntryDestination;
}

function destinationBatches(destination: EntryCarryDestination, facilityId: string): LateEntryBatch[] {
  return destination.creditBatchCodes.map((code, index) => ({
    code,
    href: creditBatchDeepLinkHref(destination.creditBatchIds[index] ?? "", facilityId),
  })).filter((_, index) => destination.creditBatchIds[index]);
}

export function waitingAction(reason: CarryWaitingReason, facilityId: string): LateEntryAction {
  if (reason === "noDraft") return { label: "New Removal", href: createIntentHref(REMOVALS_PATH, facilityId) };
  if (reason === "incompatibleTemplate") return { label: "Open Removal templates", href: removalTemplatesSettingsHref(facilityId) };
  return { label: "Open Removals", href: `${REMOVALS_PATH}?facility=${encodeURIComponent(facilityId)}` };
}

/** The reason without its "Waiting for a Removal." lead, for places that already say so. */
export function waitingDetail(reason: CarryWaitingReason): string {
  return CARRY_WAITING_REASONS[reason].replace(WAITING_PREFIX, "");
}

/** Null for every entry that is not a late one, or that no Removal is going to report. */
export function lateEntryView(entry: LateEntryFacts, facilityId: string): LateEntryView | null {
  const after = entry.recordedAfter;
  if (!after) return null;
  const sent = entry.reportedIn;
  const receiver = entry.carry?.receiver;
  const reason = entry.carry?.waitingReason;
  const recordedAfter = { removalCode: after.removalCode, removalHref: removalSheetHref(after.removalId, facilityId) };
  if (sent) {
    return { recordedAfter, destination: { kind: "reported", removalCode: sent.removalCode, removalHref: removalSheetHref(sent.removalId, facilityId), creditBatches: destinationBatches(sent, facilityId), anotherCreditBatch: sent.anotherCreditBatch } };
  }
  if (receiver) {
    return { recordedAfter, destination: { kind: "draft", removalCode: receiver.removalCode, removalHref: removalSheetHref(receiver.removalId, facilityId), creditBatches: destinationBatches(receiver, facilityId), anotherCreditBatch: receiver.anotherCreditBatch } };
  }
  if (reason) {
    return { recordedAfter, destination: { kind: "waiting", reason, text: CARRY_WAITING_REASONS[reason], action: waitingAction(reason, facilityId) } };
  }
  return null;
}

/** "Diesel use of Sep 14, 2026 is waiting for a Removal". */
export function waitingEntryTitle(componentName: string, occurredOn: string): string {
  return `${componentName} of ${formatDayString(occurredOn)} is waiting for a Removal`;
}
