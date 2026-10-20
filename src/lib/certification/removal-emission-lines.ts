import { deriveBatchEmissionLines, type BatchEmissionLineFacts } from "./emission-lines";
import type { RemovalEntryContributions, RemovalEntryFact } from "./removal-emission-contributions";
import { SOURCE_IDS } from "@/lib/isometric/template-observations/catalog-sources";
import { SOURCE_BUCKETS } from "@/lib/isometric/utils/aggregation";

export function omittedProductionSources(claimedByRemovalId: string | null | undefined, removalId: string) {
  return claimedByRemovalId && claimedByRemovalId !== removalId
    ? (Object.keys(SOURCE_IDS) as (keyof typeof SOURCE_IDS)[]).filter((key) => SOURCE_BUCKETS[key] === "production").map((key) => SOURCE_IDS[key]) : [];
}

/** Shared Removal line states for readiness, Empty lines and the zero writer. */
export function deriveRemovalBatchEmissionLines(
  facts: BatchEmissionLineFacts,
  batchId?: string,
  batch?: { entries: readonly RemovalEntryFact[]; entriesWithoutRemoval?: readonly string[] },
  contributions?: RemovalEntryContributions,
) {
  return deriveBatchEmissionLines(facts).map((line) => {
    const contributionBlocker = contributions?.blockers.find((blocker) => blocker.creditBatchId === batchId && blocker.lineRef?.componentId === line.componentId);
    if (contributionBlocker) return { ...line, ...(["singleLineMultipleEntries", "lineNeedsReview"].includes(contributionBlocker.code) ? { state: "needsReview" as const } : {}), blocker: { ...contributionBlocker, lineRef: { ...contributionBlocker.lineRef!, displayName: line.displayName } } };
    if (line.contract?.scope === "operating" && line.contract.entryPolicy !== "none" && batch?.entries.some((entry) => entry.componentId === line.componentId && batch.entriesWithoutRemoval?.includes(entry.id))) {
      return { ...line, blocker: { code: "entryHasNoRemoval" as const, message: "No Removal can carry this entry yet",
        fixTarget: "emissions" as const, lineRef: { componentId: line.componentId, displayName: line.displayName } } };
    }
    const sent = contributions && batchId && batch?.entries.some((entry) =>
      entry.componentId === line.componentId && entry.lineRule === "single" && entry.kind === "value" &&
      entry.sentByRemovalId && !(contributions.ownedEntryIds ?? contributions.selectedEntryIds).includes(entry.id));
    if (sent && line.state === "empty") return { ...line, state: "filled" as const, blocker: undefined };
    return line;
  });
}

export function isEmptyRemovalEmissionLine(line: { state: string; blocker?: { code: string } }) {
  return line.state === "empty" && line.blocker?.code === "lineHasNoSource";
}
