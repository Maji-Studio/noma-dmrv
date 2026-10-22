import { lateEntryView, type LateEntryOptions, type LateEntryView } from "./late-entry-view";
import type { EmissionLineEntryFact } from "./emission-lines";

export interface LateEntryRow {
  id: string;
  componentName: string;
  occurredOn: string;
  total: EmissionLineEntryFact["total"];
  view: LateEntryView;
}

/** The entries of one credit batch that another credit batch's Removal reports or will report, or that wait for one. */
export function lateEntryRows(
  lines: readonly { displayName: string; entries: readonly EmissionLineEntryFact[] }[],
  facilityId: string,
  options: LateEntryOptions = {},
): LateEntryRow[] {
  return lines.flatMap((line) => line.entries.flatMap((entry) => {
    const view = lateEntryView(entry, facilityId, options);
    return view && entry.occurredOn ? [{ id: entry.id ?? `${line.displayName}:${entry.occurredOn}`, componentName: line.displayName, occurredOn: entry.occurredOn, total: entry.total, view }] : [];
  })).sort((a, b) => a.occurredOn.localeCompare(b.occurredOn) || a.id.localeCompare(b.id));
}
