/**
 * The words every form's credit batch line shares (#1059 section 2): the
 * pending, error, "None yet" and "Not yet determined" states, and the shape of
 * the copy a line renders. Pure, so each state is tested without a server.
 * Form-specific matching copy (which batch a run joins, which one a sample
 * characterises) stays with its form and returns the same shape.
 */

/** A credit batch named in the line, rendered as a link. */
export interface CreditBatchLineBatch {
  id: string;
  code: string;
}

export interface CreditBatchLineCopy {
  tone: "neutral" | "warning";
  /** Text before the batch links. */
  lead: string;
  /**
   * Batches named in the line, each a link to its page. An array so a line for
   * several batches ("CB-26-009-A +2") can fold it later without a new shape.
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

/** The line's label for the ⓘ, so a screen reader names what it explains. */
export const CREDIT_BATCH_INFO_LABEL = "How the credit batch is chosen";

export const CREDIT_BATCH_LINE_PENDING = "Checking credit batch...";
export const CREDIT_BATCH_LINE_ERROR = "Credit batch could not be checked.";
export const CREDIT_BATCH_LINE_NONE_YET = "Credit batch: None yet";
export const CREDIT_BATCH_LINE_NOT_YET_DETERMINED = "Credit batch: Not yet determined";

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

/** A successful check found no batch. `info` says why that is fine. */
export function noneYetLineCopy(info: string | null = null): CreditBatchLineCopy {
  return { ...CREDIT_BATCH_LINE_BASE, lead: CREDIT_BATCH_LINE_NONE_YET, info };
}

/** Inputs are missing: `info` names what is needed, without implying a search found nothing. */
export function notYetDeterminedLineCopy(info: string | null = null): CreditBatchLineCopy {
  return { ...CREDIT_BATCH_LINE_BASE, lead: CREDIT_BATCH_LINE_NOT_YET_DETERMINED, info };
}
