import { withRemovedEntryComponents } from "./emission-line-definition";
import { ENTRY_HAS_NO_REMOVAL } from "@/lib/certification/emission-entry-messages";
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
      return { ...line, blocker: { code: "entryHasNoRemoval" as const, message: ENTRY_HAS_NO_REMOVAL,
        fixTarget: "emissions" as const, lineRef: { componentId: line.componentId, displayName: line.displayName } } };
    }
    const sent = contributions && batchId && batch?.entries.some((entry) =>
      entry.componentId === line.componentId && entry.lineRule === "single" && entry.kind === "value" &&
      (entry.sentByRemovalId ?? entry.heldForRemovalId) && !(contributions.ownedEntryIds ?? contributions.selectedEntryIds).includes(entry.id));
    if (sent && line.state === "empty") return { ...line, state: "filled" as const, blocker: undefined };
    return line;
  });
}

export function isEmptyRemovalEmissionLine(line: { state: string; blocker?: { code: string } }) {
  return line.state === "empty" && line.blocker?.code === "lineHasNoSource";
}

export interface RemovalEmissionBatchFacts extends BatchEmissionLineFacts {
  entries: readonly (BatchEmissionLineFacts["entries"][number] & RemovalEntryFact & { observationId: string })[];
  previousObservations?: Parameters<typeof withRemovedEntryComponents>[2];
  entriesWithoutRemoval?: readonly string[];
}

/** Resolve the gate and Empty components from the same loaded facts, including sent singles. */
export function deriveRemovalEmissionLines(
  batches: Record<string, RemovalEmissionBatchFacts>,
  contributions?: RemovalEntryContributions,
) {
  const emissionLinesByBatchId = Object.fromEntries(Object.entries(batches).map(([batchId, facts]) => {
    const entries = facts.entries;
    return [batchId, deriveRemovalBatchEmissionLines({
      ...facts,
      definition: withRemovedEntryComponents(facts.definition, entries, facts.previousObservations ?? new Map()),
      automaticFigures: Object.fromEntries(Object.entries(facts.automaticFigures).filter(([source]) =>
        !facts.omittedAutomaticSources?.some((id) => id === source))),
      entries: entries.filter((entry) => !contributions || (contributions.ownedEntryIds ?? contributions.selectedEntryIds).includes(entry.id)),
      entriesCanSubmit: !!contributions,
    }, batchId, { entries, entriesWithoutRemoval: facts.entriesWithoutRemoval }, contributions)];
  }));
  return { emissionLinesByBatchId, emptyLinesByBatchId: emptyRemovalEmissionLines(emissionLinesByBatchId) };
}

export function emptyRemovalEmissionLines<T extends { state: string; blocker?: { code: string } }>(linesByBatchId: Record<string, T[]>) {
  return Object.fromEntries(Object.entries(linesByBatchId).map(([id, lines]) => [id, lines.filter(isEmptyRemovalEmissionLine)]));
}
