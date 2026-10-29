import { creditBatchName } from "@/lib/credit-batch-label";
import { formatDateRange } from "@/lib/format-utils";

const LABEL_SEPARATOR = " · ";

/**
 * How a credit batch reads in a picker: the five list filters (Samples,
 * Deliveries, Applications, Production Runs, Biochar Products) and the rows of
 * the Trail batch picker. The production window alone looks like a date filter
 * on the rows, so the batch leads: its code, or "Name (CODE)" when named, since filter rows elsewhere show the code and
 * the window follows.
 */
export function creditBatchOptionLabel(batch: {
  code: string;
  name?: string | null;
  startDate: string | Date | null | undefined;
  endDate: string | Date | null | undefined;
}): string {
  const name = creditBatchName(batch);
  const label = name ? `${name} (${batch.code})` : batch.code;
  return `${label}${LABEL_SEPARATOR}${formatDateRange(batch.startDate, batch.endDate)}`;
}
