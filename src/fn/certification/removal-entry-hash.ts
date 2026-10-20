import type { EntryInputManifest } from "@/lib/certification/removal-emission-contributions";
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
export function normalizeEntrySourceBindingForHash<T extends { nomaRole: string; lineage: RemovalSourceLineage }>(binding: T): T {
  return binding.nomaRole === "emission_entry"
    ? { ...binding, lineage: { ...binding.lineage, entityLabel: "Emissions entry" } }
    : binding;
}
