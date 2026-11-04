/**
 * Folds the dashboard's cross-cutting attention into the flow stations, so the
 * "Needs attention" scene lights every station the attention card has rows
 * for (#1532 F5). The station read (`dashboard-stations.ts`) counts only the
 * per-record checks; GPS gaps and credit batches are read elsewhere and land
 * here:
 *
 *   - each structural GPS gap on the station whose form fixes it
 *   - credit batch rows on Production: a credit batch is the production
 *     cohort of one feedstock's runs (GLOSSARY), and the scene has no batch
 *     station of its own
 *
 * These reasons carry their own href, since the fix is not on the station's
 * list page. A batch awaiting verification waits on the verifier, not the
 * operator, so it never gets here; one the verifier sent back does.
 *
 * Pure, so the mapping is unit-tested without a database.
 */
import { facilityListHref, plural } from "@/lib/dashboard-links";
import { RECORD_LINKS } from "@/lib/record-links";
import type {
  DashboardStation,
  DashboardStationKey,
  DashboardStationReason,
} from "./dashboard-stations";
import type { DashboardStructuralGap } from "./dashboard-structural-gaps";

/** Credit batch rows in Needs attention, by what the operator has to do. */
export interface DashboardBatchAttentionCounts {
  /** Removals whose submission stopped part way (one row per Removal). */
  interrupted: number;
  /** Batches whose period ended with no submitted Removal. */
  notSubmitted: number;
  /** Batches whose submitted Removal the verifier sent back for correction. */
  returned: number;
}

const REASON_ORDER: DashboardStationReason["state"][] = ["error", "warning", "in-progress"];

export const BATCH_ATTENTION_STATION: DashboardStationKey = "production";

function batchReasons(counts: DashboardBatchAttentionCounts, facilityId: string): DashboardStationReason[] {
  return [
    ...(counts.interrupted > 0
      ? [{
          state: "error" as const,
          text: `${plural(counts.interrupted, "submission")} interrupted`,
          href: facilityListHref(RECORD_LINKS.removal.path, facilityId),
        }]
      : []),
    ...(counts.notSubmitted > 0
      ? [{
          state: "warning" as const,
          text: `${plural(counts.notSubmitted, "credit batch", "credit batches")} not submitted`,
          href: facilityListHref(RECORD_LINKS.creditBatch.path, facilityId),
        }]
      : []),
    ...(counts.returned > 0
      ? [{
          state: "warning" as const,
          text: `${plural(counts.returned, "credit batch", "credit batches")} returned by Isometric`,
          href: facilityListHref(RECORD_LINKS.creditBatch.path, facilityId),
        }]
      : []),
  ];
}

export function withCrossCuttingAttention(
  stations: DashboardStation[],
  structuralGaps: readonly DashboardStructuralGap[],
  batches: DashboardBatchAttentionCounts,
  facilityId: string,
): DashboardStation[] {
  const extra = new Map<DashboardStationKey, { count: number; reasons: DashboardStationReason[] }>();
  const add = (key: DashboardStationKey, count: number, reasons: DashboardStationReason[]) => {
    const current = extra.get(key) ?? { count: 0, reasons: [] };
    extra.set(key, { count: current.count + count, reasons: [...current.reasons, ...reasons] });
  };
  for (const gap of structuralGaps) {
    add(gap.station, gap.count, [{ state: "warning", text: gap.stationReason, href: gap.href }]);
  }
  const reasons = batchReasons(batches, facilityId);
  if (reasons.length > 0) add(BATCH_ATTENTION_STATION, batches.interrupted + batches.notSubmitted + batches.returned, reasons);

  return stations.map((station) => {
    const added = extra.get(station.key);
    if (!added) return station;
    return {
      ...station,
      attention: station.attention + added.count,
      // Errors, then warnings, then progress ("running now" stays last).
      reasons: [...station.reasons, ...added.reasons].sort(
        (a, b) => REASON_ORDER.indexOf(a.state) - REASON_ORDER.indexOf(b.state),
      ),
    };
  });
}
