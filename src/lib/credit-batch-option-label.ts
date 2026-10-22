import { formatDateRange } from "@/lib/format-utils";

const LABEL_SEPARATOR = " · ";

/**
 * How a credit batch reads wherever it is picked (the list filters, the Sample
 * form, the Trail picker). The production window alone looks like a date
 * filter on the rows, so the
 * code (the name operators know the batch by) leads and the window follows.
 */
export function creditBatchOptionLabel(batch: {
  code: string;
  startDate: string | Date | null | undefined;
  endDate: string | Date | null | undefined;
}): string {
  return `${batch.code}${LABEL_SEPARATOR}${formatDateRange(batch.startDate, batch.endDate)}`;
}
