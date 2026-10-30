import { formatCalendarDate } from "@/lib/format-utils";
import { canonicalDecimal } from "@/lib/isometric/template-observations/units";
import type { EmissionFigure } from "./emission-lines";

export const DATAPOINT_DESCRIPTION_MAX_LENGTH = 500;
const AGGREGATED_PRODUCTION_RUN_DESCRIPTION_PREFIX = "Aggregated from production runs ";

/** Longest render(shown) within the registry cap, trying shown = total down to 0. */
function fitDatapointDescription(total: number, render: (shown: number) => string, fallback: string): string {
  for (let shown = total; shown >= 0; shown--) {
    const description = render(shown);
    if (description.length <= DATAPOINT_DESCRIPTION_MAX_LENGTH) return description;
  }
  return fallback;
}

export function aggregatedProductionRunDatapointDescription(runIds: readonly string[]): string {
  const base = `Aggregated from ${runIds.length} production runs:`;
  return fitDatapointDescription(runIds.length, shown => shown === runIds.length
    ? `${AGGREGATED_PRODUCTION_RUN_DESCRIPTION_PREFIX}${runIds.join(", ")}`
    : [base, runIds.slice(0, shown).join(", "), `and ${runIds.length - shown} more`].filter(Boolean).join(" "), base);
}

export function fitStoredDatapointDescription(description: string): string {
  if (description.length <= DATAPOINT_DESCRIPTION_MAX_LENGTH) return description;
  if (description.startsWith(AGGREGATED_PRODUCTION_RUN_DESCRIPTION_PREFIX)) {
    const runIds = description.slice(AGGREGATED_PRODUCTION_RUN_DESCRIPTION_PREFIX.length).split(", ");
    return aggregatedProductionRunDatapointDescription(runIds);
  }
  return description.slice(0, DATAPOINT_DESCRIPTION_MAX_LENGTH);
}

export interface CarriedEntryNote {
  entryId: string;
  creditBatchCode: string;
  occurredOn: string;
  value: EmissionFigure;
  /** Only present when the entry was recorded after this Removal was sent. */
  earlierRemovalCode?: string;
}
export function carriedEntrySourceDescription(entry: Pick<CarriedEntryNote, "creditBatchCode" | "occurredOn">): string {
  return `credit batch ${entry.creditBatchCode}, used ${formatCalendarDate(entry.occurredOn)}`;
}
export function carriedEntryDatapointDescription(entries: readonly CarriedEntryNote[]): string {
  const base = "Recorded emissions entries";
  if (!entries.length) return base;
  const ordered = [...entries].sort((a, b) => a.entryId.localeCompare(b.entryId));
  const sentences = ordered.map(entry => `Includes ${canonicalDecimal(entry.value.magnitude) ?? entry.value.magnitude} ${entry.value.unit} used on ${formatCalendarDate(entry.occurredOn)} for credit batch ${entry.creditBatchCode}${entry.earlierRemovalCode ? `, recorded after its Removal ${entry.earlierRemovalCode} was sent` : ""}.`);
  return fitDatapointDescription(sentences.length, count => {
    const remaining = sentences.length - count;
    const rest = remaining ? `${count ? "And" : "Includes"} ${remaining} more ${remaining === 1 ? "entry" : "entries"} from credit batches.` : "";
    return [`${base}.`, ...sentences.slice(0, count), rest].filter(Boolean).join(" ");
  }, `${base}. Includes entries from credit batches.`);
}
