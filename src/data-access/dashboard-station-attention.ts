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
 * operator: it stays an in-progress reason and, like "running now", adds
 * nothing to the station's attention count.
 *
 * Pure, so the mapping is unit-tested without a database.
 */
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
  /** Batches whose period ended with a submitted Removal (waits on the verifier). */
  awaitingVerification: number;
}

const REASON_ORDER: DashboardStationReason["state"][] = ["error", "warning", "in-progress"];

export const BATCH_ATTENTION_STATION: DashboardStationKey = "production";

function batchWord(n: number): string {
  return `${n} ${n === 1 ? "credit batch" : "credit batches"}`;
}

function facilityList(path: string, facilityId: string): string {
  return `${path}?${new URLSearchParams({ facility: facilityId }).toString()}`;
}

function batchReasons(counts: DashboardBatchAttentionCounts, facilityId: string): DashboardStationReason[] {
  const batches = facilityList(RECORD_LINKS.creditBatch.path, facilityId);
  return [
    ...(counts.interrupted > 0
      ? [{
          state: "error" as const,
          text: `${counts.interrupted} ${counts.interrupted === 1 ? "submission" : "submissions"} interrupted`,
          href: facilityList(RECORD_LINKS.removal.path, facilityId),
        }]
      : []),
    ...(counts.notSubmitted > 0
      ? [{ state: "warning" as const, text: `${batchWord(counts.notSubmitted)} not submitted`, href: batches }]
      : []),
    ...(counts.awaitingVerification > 0
      ? [{ state: "in-progress" as const, text: `${batchWord(counts.awaitingVerification)} awaiting verification`, href: batches }]
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
  // Awaiting verification is left out of the count: the badge counts what the operator can act on.
  if (reasons.length > 0) add(BATCH_ATTENTION_STATION, batches.interrupted + batches.notSubmitted, reasons);

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
