import type { OrgContext } from "@/lib/auth/server";
import { loadFacilityEmissionsOverviewScope } from "@/data-access/facility-emissions-overview";
import type { BatchEmissionLine } from "@/lib/certification/emission-lines";
import { loadBatchesEmissionLines } from "./batches-emission-lines";
import { formatFacilityDate } from "@/lib/date-utils";

export type FacilityEmissionsOverview = {
  batches: Array<{
    creditBatchId: string; code: string; startDate: string; endDate: string | null;
    status: string;
    templateName: string | null;
    lineCounts: {
      total: number; open: number; fileMissing: number; needsReview: number; notRecorded: number;
      needsSetup: number; recorded: number;
    };
    entriesThisMonth: number;
    lastEntryOn: string | null;
  }>;
};
const MONTH_PREFIX_LENGTH = 7;
const STATE_COUNT_KEYS = {
  filled: "recorded", empty: "notRecorded", missingEvidence: "fileMissing",
  confirmedZero: "recorded", needsReview: "needsReview", needsSetup: "needsSetup",
} as const;

function lineCounts(lines: readonly Pick<BatchEmissionLine, "state">[]) {
  const counts: FacilityEmissionsOverview["batches"][number]["lineCounts"] = {
    total: lines.length, open: 0, fileMissing: 0, needsReview: 0, notRecorded: 0,
    needsSetup: 0, recorded: 0,
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
  const displayByBatch = await loadBatchesEmissionLines(ctx, batches);
  // Compare local calendar months, including the timestamp's year and zone offset.
  const month = formatFacilityDate(new Date(), timezone).slice(0, MONTH_PREFIX_LENGTH);
  return { batches: batches.map((batch) => {
    const display = displayByBatch.get(batch.id)!;
    const stored = display.storedEntries;
    return {
      creditBatchId: batch.id, code: batch.code, startDate: batch.startDate,
      endDate: batch.endDate, status: batch.status,
      // Template observations retain component names, but no template-level name.
      templateName: null,
      // One setup item represents an unread or unpinned template until its lines are known.
      lineCounts: lineCounts(display.status === "ready" ? display.lines : [{ state: "needsSetup" }]),
      entriesThisMonth: stored.filter((entry) =>
        entry.kind === "value" &&
        formatFacilityDate(entry.createdAt, timezone).slice(0, MONTH_PREFIX_LENGTH) === month,
      ).length,
      lastEntryOn: stored.reduce<string | null>((last, entry) =>
        last === null || entry.occurredOn > last ? entry.occurredOn : last, null),
    };
  }) };
}
