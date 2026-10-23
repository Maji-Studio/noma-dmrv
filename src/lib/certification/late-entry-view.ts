/**
 * What an emissions entry that another credit batch's Removal reports (or will
 * report) shows (#1059): where it goes, the Removal it was recorded after when
 * one was sent, and the one action that clears a wait. Pure, so the entry row,
 * the credit batch Overview and the to-do builder say the same words.
 */
import { creditBatchDeepLinkHref } from "@/lib/credit-batch-links";
import { createIntentHref } from "@/lib/create-intent";
import { certificationRemovalsHref, OPEN_REMOVAL_TEMPLATES_LINK_LABEL, removalTemplatesSettingsHref } from "@/lib/certification/links";
import { formatDayString } from "@/lib/format-utils";
import { removalSheetHref } from "@/lib/removal-correction-copy";
import {
  CARRY_WAITING_REASONS,
  CARRY_WAITING_DETAILS,
  type CarryWaitingReason,
  type EntryCarryDestination,
  type EntryCarryDisposition,
} from "./emission-entry-carry";

const MEMBER_TEMPLATE_TEXT = "An Admin changes it in Settings, Removal templates.";

export interface LateEntryFacts {
  carry?: EntryCarryDisposition;
  reportedIn?: EntryCarryDestination | null;
  recordedAfter?: { removalId: string; removalCode: string } | null;
}

export interface LateEntryAction { label: string; href: string }

export interface LateEntryBatch { code: string; href: string }

export type LateEntryDestination =
  | { kind: "draft" | "reported"; removalCode: string; removalHref: string; creditBatches: LateEntryBatch[]; anotherCreditBatch: boolean }
  | { kind: "waiting"; reason: CarryWaitingReason; text: string; action: LateEntryAction | null };

export interface LateEntryView {
  /** The sent Removal of the entry's own batch, when there was one before the entry was recorded. */
  recordedAfter: { removalCode: string; removalHref: string } | null;
  destination: LateEntryDestination;
}

export interface LateEntryOptions {
  /** Only an Admin changes Removal templates; anyone else reads who does. */
  canManage?: boolean;
}

function destinationBatches(destination: EntryCarryDestination, facilityId: string): LateEntryBatch[] {
  return destination.creditBatchCodes.map((code, index) => ({
    code,
    href: creditBatchDeepLinkHref(destination.creditBatchIds[index] ?? "", facilityId),
  })).filter((_, index) => destination.creditBatchIds[index]);
}

export function waitingAction(
  reason: CarryWaitingReason,
  facilityId: string,
  draft?: { removalId: string } | null,
): LateEntryAction {
  if (reason === "noDraft") return { label: "New Removal", href: createIntentHref(certificationRemovalsHref(), facilityId) };
  if (reason === "incompatibleTemplate") return { label: OPEN_REMOVAL_TEMPLATES_LINK_LABEL, href: removalTemplatesSettingsHref(facilityId) };
  if (draft) return { label: "Open Removal", href: removalSheetHref(draft.removalId, facilityId) };
  return { label: "Open Removals", href: certificationRemovalsHref({ facility: facilityId }) };
}

/** The reason without its "Waiting for a Removal." lead, for places that already say so. */
export function waitingDetail(reason: CarryWaitingReason, canManage = true): string {
  const detail = CARRY_WAITING_DETAILS[reason];
  return reason === "incompatibleTemplate" && !canManage ? `${detail} ${MEMBER_TEMPLATE_TEXT}` : detail;
}

/**
 * Null for every entry that no other credit batch's Removal reports and none is
 * going to: an entry sent by a Removal of its own batch is not a late one.
 */
export function lateEntryView(entry: LateEntryFacts, facilityId: string, options: LateEntryOptions = {}): LateEntryView | null {
  const canManage = options.canManage ?? false;
  const after = entry.recordedAfter;
  const sent = entry.reportedIn;
  const receiver = entry.carry?.receiver;
  const reason = entry.carry?.waitingReason;
  const recordedAfter = after ? { removalCode: after.removalCode, removalHref: removalSheetHref(after.removalId, facilityId) } : null;
  if (sent) {
    if (!sent.anotherCreditBatch) return null;
    return { recordedAfter, destination: { kind: "reported", removalCode: sent.removalCode, removalHref: removalSheetHref(sent.removalId, facilityId), creditBatches: destinationBatches(sent, facilityId), anotherCreditBatch: true } };
  }
  if (receiver) {
    return { recordedAfter, destination: { kind: "draft", removalCode: receiver.removalCode, removalHref: removalSheetHref(receiver.removalId, facilityId), creditBatches: destinationBatches(receiver, facilityId), anotherCreditBatch: receiver.anotherCreditBatch } };
  }
  if (reason) {
    const memberOnly = reason === "incompatibleTemplate" && !canManage;
    return { recordedAfter, destination: {
      kind: "waiting", reason, text: `${CARRY_WAITING_REASONS[reason]}${memberOnly ? ` ${MEMBER_TEMPLATE_TEXT}` : ""}`,
      action: memberOnly ? null : waitingAction(reason, facilityId, entry.carry?.waitingFor),
    } };
  }
  return null;
}

/** "Diesel use of Sep 14, 2026 is waiting for a Removal". */
export function waitingEntryTitle(componentName: string, occurredOn: string): string {
  return `${componentName} of ${formatDayString(occurredOn)} is waiting for a Removal`;
}
