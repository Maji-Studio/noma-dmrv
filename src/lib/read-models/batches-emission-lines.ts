import type { OrgContext } from "@/lib/auth/server";
import { listEmissionEntriesForBatches } from "@/data-access/emission-entries";
import { getLatestTemplateObservations, getTemplateObservationsByIds } from "@/data-access/removal-template-observations";
import { loadBatchesEmissionAutomaticFacts } from "@/data-access/batch-emission-automatic-figures";
import { deriveEmissionEntryFacts } from "@/lib/certification/emission-entry-facts";
import { buildBatchEmissionLines } from "./batch-emission-lines";

/**
 * Shared display derivation for an already authorized set of batches. Every
 * loader is set-based; unread or unpinned templates have no derivable lines.
 * Comments are omitted because they do not affect line states or counts.
 */
export async function loadBatchesEmissionLines(
  ctx: OrgContext,
  batches: readonly { id: string; removalTemplateId: string | null }[],
): Promise<Map<string, {
  lines: ReturnType<typeof buildBatchEmissionLines> | undefined;
  storedEntries: Awaited<ReturnType<typeof listEmissionEntriesForBatches>>;
}>> {
  if (!batches.length) return new Map();
  const ids = batches.map((batch) => batch.id);
  const templateIds = [...new Set(batches.flatMap((batch) => batch.removalTemplateId ? [batch.removalTemplateId] : []))];
  const [observations, storedEntries, automatic] = await Promise.all([
    getLatestTemplateObservations(ctx, "isometric", templateIds),
    listEmissionEntriesForBatches(ctx, ids),
    loadBatchesEmissionAutomaticFacts(ctx, ids),
  ]);
  const byTemplate = new Map(observations.map((observation) => [observation.externalTemplateId, observation]));
  const byId = new Map(observations.map((observation) => [observation.id, observation]));
  const previousIds = [...new Set(storedEntries.map((entry) => entry.observationId))].filter((id) => !byId.has(id));
  const previous = await getTemplateObservationsByIds(ctx, previousIds);
  for (const observation of previous) byId.set(observation.id, observation);
  const entriesByBatch = new Map<string, typeof storedEntries>();
  for (const entry of storedEntries) {
    const list = entriesByBatch.get(entry.creditBatchId) ?? [];
    list.push(entry);
    entriesByBatch.set(entry.creditBatchId, list);
  }
  return new Map(batches.map((batch) => {
    const observation = batch.removalTemplateId ? byTemplate.get(batch.removalTemplateId) : undefined;
    const stored = entriesByBatch.get(batch.id) ?? [];
    const entries = observation ? deriveEmissionEntryFacts(stored, observation, byId) : [];
    const lines = observation
      ? buildBatchEmissionLines(observation, entries, byId, automatic[batch.id])
      : undefined;
    return [batch.id, { lines, storedEntries: stored }] as const;
  }));
}
