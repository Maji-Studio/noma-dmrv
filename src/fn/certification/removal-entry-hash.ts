import type { EntryInputManifest, RemovalEntryContributions } from "@/lib/certification/removal-emission-contributions";
import type { RemovalSourceLineage } from "@/lib/certification/removal-source-bindings";

/** Like template display names, entry labels describe content without changing it. */
export function normalizeEntryContributionsForHash(manifest: EntryInputManifest[]) {
  return manifest.map((input) => {
    const semantic = { ...input, entries: input.entries.map((entry) => {
      const semanticEntry = { ...entry };
      delete semanticEntry.creditBatchCode;
      return semanticEntry;
    }) };
    delete semantic.componentDisplayName;
    return semantic;
  });
}

/** Other roles retain their frozen labels. Entry labels refresh from live local facts.
 * Keep a stable role label so semantic snapshots still satisfy the lineage reader.
 */
export function normalizeEntrySourceBindingForHash<T extends {
  nomaRole: string; lineage: RemovalSourceLineage;
  carriedEntry?: { creditBatchCode: string; occurredOn: string };
}>(binding: T) {
  if (binding.nomaRole !== "emission_entry") return binding;
  return { ...binding, lineage: { ...binding.lineage, entityLabel: "Emissions entry" },
    ...(binding.carriedEntry ? { carriedEntry: { occurredOn: binding.carriedEntry.occurredOn } } : {}),
  };
}

/** Carry labels remain available to operators and registry descriptions, outside the hash. */
export function normalizeCarriedEntriesForHash(entries: RemovalEntryContributions["carriedEntries"]) {
  return entries?.map(entry => ({
    entryId: entry.entryId, creditBatchId: entry.creditBatchId, componentId: entry.componentId,
    occurredOn: entry.occurredOn, value: entry.value,
    evidenceDocumentIds: [...entry.evidenceDocumentIds].sort(),
    ...(entry.earlierRemovalId ? { earlierRemovalId: entry.earlierRemovalId } : {}),
  })).sort((a, b) => a.entryId.localeCompare(b.entryId));
}
