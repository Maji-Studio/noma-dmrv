import { recordedAfter } from "./emission-entry-carry";
import type { LateEntryFacts } from "./late-entry-view";

type CarryFacts = LateEntryFacts & { id: string; earlierRemovalId?: string; earlierRemovalCode?: string };
/** Attach carry display facts consistently to each independently derived entry. */
export function mergeEntryCarryFacts<T extends { id: string }>(entries: readonly T[], carriedEntries: readonly CarryFacts[]) {
  const byId = new Map(carriedEntries.map(entry => [entry.id, entry]));
  return entries.map(entry => {
    const carried = byId.get(entry.id);
    return { ...entry, carry: carried?.carry, reportedIn: carried?.reportedIn, recordedAfter: recordedAfter(carried) };
  });
}
