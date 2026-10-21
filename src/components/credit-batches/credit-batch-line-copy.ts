/**
 * The words every form's credit batch line shares (#1059 section 2): the
 * pending, error, "None yet" and "Not yet determined" states, and the shape of
 * the copy a line renders. Pure, so each state is tested without a server.
 * Form-specific matching copy (which batch a run joins, which one a sample
 * characterises) stays with its form and returns the same shape.
 */

import type { MissingValueCopy } from "@/lib/copy-utils";

/** A credit batch named in the line, rendered as a link. */
export interface CreditBatchLineBatch {
  id: string;
  code: string;
  /** The batch's date window; named in the list a several-batch line opens. */
  startDate?: string | Date | null;
  endDate?: string | Date | null;
}

export interface CreditBatchLineCopy {
  tone: "neutral" | "warning";
  /** Text before the batch links. */
  lead: string;
  /**
   * Batches named in the line, each a link to its page. With several, the
   * line shows the first code and a "+N" button opening the full list.
   */
  batches: CreditBatchLineBatch[];
  /** Text after the batch links. */
  tail: string;
  /** The ⓘ explanation, or null when the line says it all. */
  info: string | null;
  /** Names the ⓘ for a screen reader; defaults to `CREDIT_BATCH_INFO_LABEL`. */
  infoLabel?: string;
  /** The check failed: offer Retry. */
  retry: boolean;
  busy: boolean;
}

/** How long a form's inputs rest before a credit batch preview asks the server again. */
export const CREDIT_BATCH_PREVIEW_DEBOUNCE_MS = 350;

/** The line's label for the ⓘ, so a screen reader names what it explains. */
export const CREDIT_BATCH_INFO_LABEL = "How the credit batch is chosen";

export const CREDIT_BATCH_LINE_PENDING = "Checking credit batch...";
export const CREDIT_BATCH_LINE_ERROR = "Credit batch could not be checked.";

export const CREDIT_BATCH_LINE_BASE: Omit<CreditBatchLineCopy, "lead"> = {
  tone: "neutral",
  batches: [],
  tail: "",
  info: null,
  retry: false,
  busy: false,
};

/** A check is running; clears any earlier claim about a batch. */
export function pendingLineCopy(): CreditBatchLineCopy {
  return { ...CREDIT_BATCH_LINE_BASE, lead: CREDIT_BATCH_LINE_PENDING, busy: true };
}

/** The check failed: distinct from "None yet", never names a batch. */
export function errorLineCopy(): CreditBatchLineCopy {
  return { ...CREDIT_BATCH_LINE_BASE, tone: "warning", lead: CREDIT_BATCH_LINE_ERROR, retry: true };
}

/**
 * The line has no batch to name. The token comes from the shared
 * missing-value vocabulary, never hand-written; `info` says why.
 */
export function missingLineCopy(token: MissingValueCopy, info: string | null = null): CreditBatchLineCopy {
  return { ...CREDIT_BATCH_LINE_BASE, lead: `Credit batch: ${token}`, info };
}
