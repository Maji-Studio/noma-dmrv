/**
 * Folds the dashboard's cross-cutting attention into the flow stations, so the
 * "Needs attention" scene lights every station the attention card has rows
 * for (#1532 F5). The station read (`dashboard-stations.ts`) counts only the
 * per-record checks; GPS gaps and credit batches are read elsewhere and land
 * here:
 *
 *   - each structural GPS gap on the station its records belong to
 *   - credit batch rows on Production: a credit batch is the production
 *     cohort of one feedstock's runs (GLOSSARY), and the scene has no batch
 *     station of its own
 *
 * Pure, so the mapping is unit-tested without a database.
 */
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
  /** Batches whose period ended with a submitted Removal. */
  awaitingVerification: number;
}

const REASON_ORDER: DashboardStationReason["state"][] = ["error", "warning", "in-progress"];

export const BATCH_ATTENTION_STATION: DashboardStationKey = "production";

export function batchAttentionTotal(counts: DashboardBatchAttentionCounts): number {
  return counts.interrupted + counts.notSubmitted + counts.awaitingVerification;
}

function batchWord(n: number): string {
  return `${n} ${n === 1 ? "credit batch" : "credit batches"}`;
}

function batchReasons(counts: DashboardBatchAttentionCounts): DashboardStationReason[] {
  return [
    ...(counts.interrupted > 0
      ? [{
          state: "error" as const,
          text: `${counts.interrupted} ${counts.interrupted === 1 ? "submission" : "submissions"} interrupted`,
        }]
      : []),
    ...(counts.notSubmitted > 0
      ? [{ state: "warning" as const, text: `${batchWord(counts.notSubmitted)} not submitted` }]
      : []),
    ...(counts.awaitingVerification > 0
      ? [{ state: "in-progress" as const, text: `${batchWord(counts.awaitingVerification)} awaiting verification` }]
      : []),
  ];
}

export function withCrossCuttingAttention(
  stations: DashboardStation[],
  structuralGaps: readonly DashboardStructuralGap[],
  batches: DashboardBatchAttentionCounts,
): DashboardStation[] {
  const extra = new Map<DashboardStationKey, { count: number; reasons: DashboardStationReason[] }>();
  const add = (key: DashboardStationKey, count: number, reasons: DashboardStationReason[]) => {
    const current = extra.get(key) ?? { count: 0, reasons: [] };
    extra.set(key, { count: current.count + count, reasons: [...current.reasons, ...reasons] });
  };
  for (const gap of structuralGaps) {
    add(gap.station, gap.count, [{ state: "warning", text: gap.stationReason }]);
  }
  const batchTotal = batchAttentionTotal(batches);
  if (batchTotal > 0) add(BATCH_ATTENTION_STATION, batchTotal, batchReasons(batches));

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
