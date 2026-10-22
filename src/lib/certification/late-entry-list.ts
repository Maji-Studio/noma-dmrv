import { lateEntryView, type LateEntryView } from "./late-entry-view";
import type { EmissionLineEntryFact } from "./emission-lines";

export interface LateEntryRow {
  id: string;
  componentName: string;
  occurredOn: string;
  total: EmissionLineEntryFact["total"];
  view: LateEntryView;
}

/** The entries of one credit batch recorded after its Removal was sent, with a Removal that has them or none yet. */
export function lateEntryRows(
  lines: readonly { displayName: string; entries: readonly EmissionLineEntryFact[] }[],
  facilityId: string,
): LateEntryRow[] {
  return lines.flatMap((line) => line.entries.flatMap((entry) => {
    const view = lateEntryView(entry, facilityId);
    return view && entry.occurredOn ? [{ id: entry.id ?? `${line.displayName}:${entry.occurredOn}`, componentName: line.displayName, occurredOn: entry.occurredOn, total: entry.total, view }] : [];
  })).sort((a, b) => a.occurredOn.localeCompare(b.occurredOn) || a.id.localeCompare(b.id));
}
