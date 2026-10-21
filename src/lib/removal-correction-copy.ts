import { ghgStatementDeepLinkHref } from "@/lib/ghg-statement-links";
import { creditBatchDeepLinkHref } from "@/lib/credit-batch-links";
import { certificationRemovalsHref } from "@/lib/certification/links";
import type { RemovalCorrection } from "@/lib/certification/removal-entry-correction";
import { formatDate, formatDateRange } from "@/lib/format-utils";

/**
 * Words and links for a Removal whose GHG Statement Isometric returned, shared
 * by the Removals list, the Removal sheet and the credit batch open items so
 * one state is always said the same way. The server decides the state
 * (`RemovalCorrection`); this only words it.
 */

/** The status while nothing sent has changed since the return; the same words as #1134's lock-based label. */
export const CORRECTION_NEEDED_STATUS_LABEL = "Correction needed";
/** The status once a sent fact changed: the Removal must go out again. */
export const RESUBMIT_NEEDED_LABEL = "Resubmit needed";
export const RESUBMIT_REMOVAL_LABEL = "Resubmit Removal";
export const OPEN_GHG_STATEMENT_LABEL = "Open GHG Statement";

/** What Isometric said about the returned statement, in the operator's words. */
export function returnedStatementPhrase(status: string | null): string {
  return status === "FAILED_VERIFICATION" ? "failed verification" : "is back in draft";
}

/** The badge a returned Removal shows in place of its own status. */
export function correctionStatus(correction: RemovalCorrection): { value: "pending"; label: string } {
  return { value: "pending", label: correction.resubmitNeeded ? RESUBMIT_NEEDED_LABEL : CORRECTION_NEEDED_STATUS_LABEL };
}

/** "GHG Statement Jul 1 to Sep 30, 2026", or "GHG Statement ending Sep 30, 2026" before the server knows the start. */
export function correctionStatementLabel(statement: RemovalCorrection["statement"]): string {
  return statement.reportingPeriodStartOn
    ? `GHG Statement ${formatDateRange(statement.reportingPeriodStartOn, statement.reportingPeriodEndOn)}`
    : `GHG Statement ending ${formatDate(statement.reportingPeriodEndOn)}`;
}

/** Each component once, in the order the server listed them. */
export function changedComponentNames(correction: RemovalCorrection): string[] {
  return [...new Set(correction.changed.map((change) => change.componentName))];
}

/** "A", "A and B", "A, B and C". */
export function joinWithAnd(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function correctionStatementHref(correction: RemovalCorrection, facilityId: string): string {
  return ghgStatementDeepLinkHref(correction.statement.id, facilityId);
}

/** Where the sent entries of a credit batch are corrected. */
export function correctionBatchEmissionsHref(batchId: string, facilityId: string): string {
  return creditBatchDeepLinkHref(batchId, facilityId, { tab: "emissions" });
}

/** The Removal's own sheet on the Removals list. */
export function removalSheetHref(removalId: string, facilityId: string): string {
  return certificationRemovalsHref({ facility: facilityId, removal: removalId });
}

/** The New Removal wizard reopened on this Removal, which resubmits it. */
export function removalResubmitHref(removalId: string, facilityId: string): string {
  return certificationRemovalsHref({ facility: facilityId, resume: removalId });
}
