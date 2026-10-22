import { formatDateRange } from "@/lib/format-utils";

const LABEL_SEPARATOR = " · ";

/**
 * How a credit batch reads in a picker: the five list filters (Samples,
 * Deliveries, Applications, Production Runs, Biochar Products) and the rows of
 * the Trail batch picker. The production window alone looks like a date filter
 * on the rows, so the code (the name operators know the batch by) leads and
 * the window follows.
 */
export function creditBatchOptionLabel(batch: {
  code: string;
  startDate: string | Date | null | undefined;
  endDate: string | Date | null | undefined;
}): string {
  return `${batch.code}${LABEL_SEPARATOR}${formatDateRange(batch.startDate, batch.endDate)}`;
}
