import { formatCalendarDate } from "@/lib/format-utils";
import { canonicalDecimal } from "@/lib/isometric/template-observations/units";
import type { EmissionFigure } from "./emission-lines";

export const DATAPOINT_DESCRIPTION_MAX_LENGTH = 500;

export function aggregatedProductionRunDatapointDescription(runIds: readonly string[]): string {
  const fullDescription = `Aggregated from production runs ${runIds.join(", ")}`;
  if (fullDescription.length <= DATAPOINT_DESCRIPTION_MAX_LENGTH) return fullDescription;

  const base = `Aggregated from ${runIds.length} production runs:`;
  for (let count = runIds.length - 1; count >= 0; count--) {
    const remaining = runIds.length - count;
    const description = [base, runIds.slice(0, count).join(", "), `and ${remaining} more`].filter(Boolean).join(" ");
    if (description.length <= DATAPOINT_DESCRIPTION_MAX_LENGTH) return description;
  }
  return base;
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
  for (let count = sentences.length; count >= 0; count--) {
    const remaining = sentences.length - count;
    const rest = remaining ? `${count ? "And" : "Includes"} ${remaining} more ${remaining === 1 ? "entry" : "entries"} from credit batches.` : "";
    const description = [`${base}.`, ...sentences.slice(0, count), rest].filter(Boolean).join(" ");
    if (description.length <= DATAPOINT_DESCRIPTION_MAX_LENGTH) return description;
  }
  return `${base}. Includes entries from credit batches.`;
}
