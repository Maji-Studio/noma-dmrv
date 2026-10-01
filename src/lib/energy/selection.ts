/**
 * Client-side narrowing of an energy breakdown: the credit batch filter,
 * per-source totals for the activity panel, and the list ranking.
 */
import {
  DIESEL_SOURCE_KEYS,
  ENERGY_SOURCE_KEYS,
  sumSourceAmounts,
  type EnergySourceKey,
} from "./sources";
import type {
  EnergyFlow,
  EnergyGap,
  EnergyProduction,
  EnergyRecord,
} from "./types";

export function flowsForBatch(flows: EnergyFlow[], batchId: string | null): EnergyFlow[] {
  return batchId == null ? flows : flows.filter((flow) => flow.creditBatchId === batchId);
}

export function gapsForBatch(gaps: EnergyGap[], batchId: string | null): EnergyGap[] {
  return batchId == null ? gaps : gaps.filter((gap) => gap.creditBatchIds.includes(batchId));
}

export function recordsForBatch(records: EnergyRecord[], batchId: string | null): EnergyRecord[] {
  return batchId == null
    ? records
    : records.filter((record) => record.creditBatchIds.includes(batchId));
}

export function producedDryKg(production: EnergyProduction[], batchId: string | null): number {
  return production
    .filter((entry) => batchId == null || entry.creditBatchId === batchId)
    .reduce((total, entry) => total + entry.dryMassKg, 0);
}

export interface SourceTotal {
  activity: number;
  /** Null when the facility has no factors. */
  kg: number | null;
  missingReadings: number;
}

export function totalsBySource(
  flows: EnergyFlow[],
  gaps: EnergyGap[],
  hasFactors: boolean,
): Record<EnergySourceKey, SourceTotal> {
  const totals = Object.fromEntries(
    ENERGY_SOURCE_KEYS.map((key) => [key, { activity: 0, kg: hasFactors ? 0 : null, missingReadings: 0 }]),
  ) as Record<EnergySourceKey, SourceTotal>;
  for (const flow of flows) {
    const total = totals[flow.source];
    total.activity += flow.activity;
    if (total.kg != null) total.kg += flow.kg ?? 0;
  }
  for (const gap of gaps) totals[gap.source].missingReadings += 1;
  return totals;
}

export function totalKg(flows: EnergyFlow[]): number {
  return flows.reduce((total, flow) => total + (flow.kg ?? 0), 0);
}

export function recordKg(record: EnergyRecord): number | null {
  return record.footprint.kg ? sumSourceAmounts(record.footprint.kg) : null;
}

export function recordDieselLitres(record: EnergyRecord): number {
  return sumSourceAmounts(record.footprint.activity, DIESEL_SOURCE_KEYS);
}

/**
 * What the list ranks by: estimated kg CO2e, or litres of diesel when the
 * facility has no factors (one unit across the three diesel sources).
 */
export function recordRankValue(record: EnergyRecord): number {
  return recordKg(record) ?? recordDieselLitres(record);
}

export function rankRecords(records: EnergyRecord[]): EnergyRecord[] {
  return [...records].sort(
    (a, b) => recordRankValue(b) - recordRankValue(a) || a.code.localeCompare(b.code),
  );
}

export function recordHasMissingReadings(record: EnergyRecord): boolean {
  return Object.keys(record.footprint.gaps).length > 0;
}
