import { formatCalendarDate } from "@/lib/format-utils";

const MAX_LISTED_ENTRIES = 5;

/** Operator copy for a refused batch edit. Dates are persisted calendar dates. */
export function formatCreditBatchEntryDateConflict(
  batchCode: string,
  entries: readonly { displayName: string; occurredOn: string }[],
): string {
  const listed = entries.slice(0, MAX_LISTED_ENTRIES)
    .map((entry) => `${entry.displayName} on ${formatCalendarDate(entry.occurredOn)}`);
  const remaining = entries.length - listed.length;
  if (remaining > 0) listed.push(`and ${remaining} more`);
  const singular = entries.length === 1;
  return `Credit batch ${batchCode} was not changed. ${entries.length} manual ${singular ? "entry falls" : "entries fall"} outside the new dates: ${listed.join("; ")}. Change or delete ${singular ? "it" : "them"} on the Emissions page first.`;
}
