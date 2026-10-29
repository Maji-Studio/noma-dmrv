import { creditBatchLabel } from "@/lib/credit-batch-label";
import { formatDateRange } from "@/lib/format-utils";

const LABEL_SEPARATOR = " · ";

/**
 * How a credit batch reads in a picker: the five list filters (Samples,
 * Deliveries, Applications, Production Runs, Biochar Products) and the rows of
 * the Trail batch picker. The production window alone looks like a date filter
 * on the rows, so the label (the batch's name, else its code) leads and
 * the window follows.
 */
export function creditBatchOptionLabel(batch: {
  code: string;
  name?: string | null;
  startDate: string | Date | null | undefined;
  endDate: string | Date | null | undefined;
}): string {
  return `${creditBatchLabel(batch)}${LABEL_SEPARATOR}${formatDateRange(batch.startDate, batch.endDate)}`;
}
