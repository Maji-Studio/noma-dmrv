import type { OrgContext } from "@/lib/auth/server";
import { loadFacilityEmissionsOverviewScope } from "@/data-access/facility-emissions-overview";
import { listEmissionEntriesForBatches } from "@/data-access/emission-entries";
import { getLatestTemplateObservations, getTemplateObservationsByIds } from "@/data-access/removal-template-observations";
import { loadBatchesEmissionAutomaticFacts } from "@/data-access/batch-emission-automatic-figures";
import { emissionsEntriesEnabled } from "@/lib/certification/emissions-entry-gate";
import { deriveEmissionEntryFacts } from "@/lib/certification/emission-entry-facts";
import type { BatchEmissionLine } from "@/lib/certification/emission-lines";
import { formatFacilityDate } from "@/lib/date-utils";
import { buildBatchEmissionLines } from "./batch-emission-lines";

export type FacilityEmissionsOverview = {
  batches: Array<{
    creditBatchId: string; code: string; startDate: string; endDate: string | null;
    status: string;
    templateName: string | null;
    lineCounts: {
      total: number; open: number; fileMissing: number; needsReview: number; notRecorded: number;
      nothingToRecord: number; needsSetup: number; recorded: number;
    };
    entriesThisMonth: number;
    lastEntryOn: string | null;
  }>;
};
const MONTH_PREFIX_LENGTH = 7;
const STATE_COUNT_KEYS = {
  filled: "recorded", empty: "notRecorded", missingEvidence: "fileMissing",
  confirmedZero: "nothingToRecord", needsReview: "needsReview", needsSetup: "needsSetup",
} as const;

function lineCounts(lines: readonly Pick<BatchEmissionLine, "state">[]) {
  const counts: FacilityEmissionsOverview["batches"][number]["lineCounts"] = {
    total: lines.length, open: 0, fileMissing: 0, needsReview: 0, notRecorded: 0,
    nothingToRecord: 0, needsSetup: 0, recorded: 0,
  };
  for (const line of lines) counts[STATE_COUNT_KEYS[line.state]]++;
  counts.open = counts.notRecorded + counts.fileMissing + counts.needsReview + counts.needsSetup;
  return counts;
}

/** Stored display facts only. Query count does not grow with the number of batches. */
export async function loadFacilityEmissionsOverview(
  ctx: OrgContext, facilityId: string,
): Promise<FacilityEmissionsOverview> {
  const { batches, timezone } = await loadFacilityEmissionsOverviewScope(ctx, facilityId);
  if (!batches.length) return { batches: [] };
  const enabled = emissionsEntriesEnabled();
  const ids = batches.map((batch) => batch.id);
  const templateIds = [...new Set(batches.flatMap((batch) => batch.removalTemplateId ? [batch.removalTemplateId] : []))];
  const [observations, storedEntries, automatic] = await Promise.all([
    getLatestTemplateObservations(ctx, "isometric", templateIds),
    enabled ? listEmissionEntriesForBatches(ctx, ids) : Promise.resolve([]),
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
  // Compare local calendar months, including the timestamp's year and zone offset.
  const month = formatFacilityDate(new Date(), timezone).slice(0, MONTH_PREFIX_LENGTH);
  return { batches: batches.map((batch) => {
    const observation = batch.removalTemplateId ? byTemplate.get(batch.removalTemplateId) : undefined;
    const stored = entriesByBatch.get(batch.id) ?? [];
    const entries = observation ? deriveEmissionEntryFacts(stored, observation, byId) : [];
    const lines = observation
      ? buildBatchEmissionLines(observation, entries, byId, automatic[batch.id])
      : [];
    return {
      creditBatchId: batch.id, code: batch.code, startDate: batch.startDate,
      endDate: batch.endDate, status: batch.status,
      // Template observations retain component names, but no template-level name.
      templateName: null,
      // One setup item represents an unread or unpinned template until its lines are known.
      lineCounts: lineCounts(observation ? lines : [{ state: "needsSetup" }]),
      entriesThisMonth: stored.filter((entry) =>
        (entry.kind === "value" || entry.confirmedForRemovalId === null) &&
        formatFacilityDate(entry.createdAt, timezone).slice(0, MONTH_PREFIX_LENGTH) === month,
      ).length,
      lastEntryOn: stored.reduce<string | null>((last, entry) =>
        last === null || entry.occurredOn > last ? entry.occurredOn : last, null),
    };
  }) };
}
