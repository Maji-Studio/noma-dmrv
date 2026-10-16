/**
 * Client-side narrowing of an energy breakdown: the credit batch filter,
 * per-source totals for the summary line, and the list ranking. Activity
 * only; no CO2e.
 */
import { creditBatchInPeriod } from "./period";
import {
  DIESEL_SOURCE_KEYS,
  ENERGY_SOURCE_KEYS,
  sumSourceAmounts,
  type EnergySourceKey,
} from "./sources";
import type {
  EnergyCreditBatchInput,
  EnergyFlow,
  EnergyGap,
  EnergyPeriod,
  EnergyRecord,
} from "./types";

/**
 * The credit batch a selection resolves to. A batch counts when its dates
 * overlap the period or when energy in the period reaches it: a July batch's
 * delivery in September puts a July node on September's Sankey, and clicking
 * that node must filter by it.
 */
export function resolveSelectedBatch(
  creditBatches: EnergyCreditBatchInput[],
  period: EnergyPeriod,
  flows: EnergyFlow[],
  requestedId: string | null,
): EnergyCreditBatchInput | null {
  if (requestedId == null) return null;
  const batch = creditBatches.find((candidate) => candidate.id === requestedId);
  if (!batch) return null;
  return creditBatchInPeriod(batch, period) || flows.some((flow) => flow.creditBatchId === requestedId)
    ? batch
    : null;
}

/**
 * Credit batch select options: the batches whose dates overlap the period,
 * plus the selected one when it reached the period only through its energy,
 * so the select can show what is selected.
 */
export function creditBatchOptions(
  creditBatches: EnergyCreditBatchInput[],
  period: EnergyPeriod,
  selected: EnergyCreditBatchInput | null,
): EnergyCreditBatchInput[] {
  const options = creditBatches.filter((batch) => creditBatchInPeriod(batch, period));
  return selected && !options.some((batch) => batch.id === selected.id)
    ? [...options, selected]
    : options;
}

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

export interface SourceTotal {
  activity: number;
}

export function totalsBySource(flows: EnergyFlow[]): Record<EnergySourceKey, SourceTotal> {
  const totals = Object.fromEntries(
    ENERGY_SOURCE_KEYS.map((key) => [key, { activity: 0 }]),
  ) as Record<EnergySourceKey, SourceTotal>;
  for (const flow of flows) {
    const total = totals[flow.source];
    total.activity += flow.activity;
  }
  return totals;
}

export function recordDieselLitres(record: EnergyRecord): number {
  return sumSourceAmounts(record.footprint.activity, DIESEL_SOURCE_KEYS);
}

/** What the list ranks by: litres of diesel, one unit across the three diesel sources. */
export function recordRankValue(record: EnergyRecord): number {
  return recordDieselLitres(record);
}

export function rankRecords(records: EnergyRecord[]): EnergyRecord[] {
  return [...records].sort(
    (a, b) => recordRankValue(b) - recordRankValue(a) || a.code.localeCompare(b.code),
  );
}

export function recordHasMissingReadings(record: EnergyRecord): boolean {
  return Object.keys(record.footprint.gaps).length > 0;
}
