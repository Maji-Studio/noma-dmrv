import type { OrgContext } from "@/lib/auth/server";
import { listEmissionEntriesForBatches } from "@/data-access/emission-entries";
import { getLatestTemplateObservations, getTemplateObservationsByIds } from "@/data-access/removal-template-observations";
import { loadBatchesEmissionAutomaticFacts } from "@/data-access/batch-emission-automatic-figures";
import { listEmissionLineCommentsForBatches } from "@/data-access/emission-line-comments";
import { deriveEmissionEntryFacts } from "@/lib/certification/emission-entry-facts";
import { buildBatchEmissionLines } from "./batch-emission-lines";

export type BatchEmissionLinesResult =
  | { status: "ready"; lines: ReturnType<typeof buildBatchEmissionLines>; storedEntries: StoredEntries }
  | { status: "blocked"; blocker: "unpinnedTemplate" | "templateNotFullyRead"; storedEntries: StoredEntries };

type StoredEntries = Awaited<ReturnType<typeof listEmissionEntriesForBatches>>;

/** Shared display read for an already authorized set of batches. */
export async function loadBatchesEmissionLines(
  ctx: OrgContext,
  batches: readonly { id: string; removalTemplateId: string | null }[],
  { comments = false }: { comments?: boolean } = {},
): Promise<Map<string, BatchEmissionLinesResult>> {
  if (!batches.length) return new Map();
  const ids = batches.map((batch) => batch.id);
  const templateIds = [...new Set(batches.flatMap((batch) => batch.removalTemplateId ? [batch.removalTemplateId] : []))];
  const [observations, storedEntries, storedComments] = await Promise.all([
    getLatestTemplateObservations(ctx, "isometric", templateIds),
    listEmissionEntriesForBatches(ctx, ids),
    comments ? listEmissionLineCommentsForBatches(ctx, ids) : [],
  ]);
  const byTemplate = new Map(observations.map((observation) => [observation.externalTemplateId, observation]));
  // Missing observation is the only unread-template blocker. Incomplete
  // enrichment still builds display lines, exactly like the single-batch read.
  const readyIds = batches.filter((batch) => batch.removalTemplateId && byTemplate.has(batch.removalTemplateId)).map((batch) => batch.id);
  const byId = new Map(observations.map((observation) => [observation.id, observation]));
  const previousIds = [...new Set(storedEntries.map((entry) => entry.observationId))].filter((id) => !byId.has(id));
  const [previous, automatic] = await Promise.all([
    getTemplateObservationsByIds(ctx, previousIds),
    readyIds.length
      ? loadBatchesEmissionAutomaticFacts(ctx, readyIds)
      : Promise.resolve<Awaited<ReturnType<typeof loadBatchesEmissionAutomaticFacts>>>({}),
  ]);
  for (const observation of previous) byId.set(observation.id, observation);
  const entriesByBatch = new Map<string, typeof storedEntries>();
  for (const entry of storedEntries) {
    const list = entriesByBatch.get(entry.creditBatchId) ?? [];
    list.push(entry);
    entriesByBatch.set(entry.creditBatchId, list);
  }
  const commentsByBatch = new Map<string, typeof storedComments>();
  for (const comment of storedComments) {
    const list = commentsByBatch.get(comment.creditBatchId) ?? [];
    list.push(comment);
    commentsByBatch.set(comment.creditBatchId, list);
  }
  return new Map(batches.map((batch): readonly [string, BatchEmissionLinesResult] => {
    const observation = batch.removalTemplateId ? byTemplate.get(batch.removalTemplateId) : undefined;
    const stored = entriesByBatch.get(batch.id) ?? [];
    if (!batch.removalTemplateId) return [batch.id, { status: "blocked", blocker: "unpinnedTemplate", storedEntries: stored }];
    if (!observation) return [batch.id, { status: "blocked", blocker: "templateNotFullyRead", storedEntries: stored }];
    const entries = deriveEmissionEntryFacts(stored, observation, byId);
    const lines = buildBatchEmissionLines(observation, entries, byId, automatic[batch.id], commentsByBatch.get(batch.id));
    return [batch.id, { status: "ready", lines, storedEntries: stored }];
  }));
}
