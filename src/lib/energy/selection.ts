/**
 * Client-side narrowing of an energy breakdown: the credit batch filter,
 * per-source totals for the summary line, and the list ranking. Activity
 * only; no CO2e.
 */
import { creditBatchInPeriod, dayInPeriod } from "./period";
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
 * delivery in September is September energy, so that batch stays selectable.
 */
export function resolveSelectedBatch(
  creditBatches: EnergyCreditBatchInput[],
  period: EnergyPeriod,
  flows: EnergyFlow[],
  requestedId: string | null,
): EnergyCreditBatchInput | null {
  if (requestedId == null) return null;
  const batch = creditBatches.find((candidate) => candidate.id === requestedId);
  return batch && batchReachesPeriod(batch, period, flows) ? batch : null;
}

/**
 * Whether a batch's dates overlap the period or a flow dated inside the period
 * reaches it. Flows outside the period never count, so a selection held from a
 * longer period is not kept by energy the new period does not contain.
 */
export function batchReachesPeriod(
  batch: EnergyCreditBatchInput,
  period: EnergyPeriod,
  flows: EnergyFlow[],
): boolean {
  return creditBatchInPeriod(batch, period) || flows.some((flow) => flow.creditBatchId === batch.id && dayInPeriod(flow.day, period));
}

/**
 * Credit batch select options: the batches whose dates overlap the period
 * plus those the period's energy reaches (a July batch delivered in October),
 * so every batch with figures in the period can be picked.
 */
export function creditBatchOptions(
  creditBatches: EnergyCreditBatchInput[],
  period: EnergyPeriod,
  flows: EnergyFlow[],
): EnergyCreditBatchInput[] {
  return creditBatches.filter((batch) => batchReachesPeriod(batch, period, flows));
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
  /** False when no reading of this source was recorded in the selection. */
  recorded: boolean;
  missingReadings: number;
}

export function totalsBySource(
  flows: EnergyFlow[],
  gaps: EnergyGap[],
): Record<EnergySourceKey, SourceTotal> {
  const totals = Object.fromEntries(
    ENERGY_SOURCE_KEYS.map((key) => [key, { activity: 0, recorded: false, missingReadings: 0 }]),
  ) as Record<EnergySourceKey, SourceTotal>;
  for (const flow of flows) {
    const total = totals[flow.source];
    total.activity += flow.activity;
    total.recorded = true;
  }
  for (const gap of gaps) totals[gap.source].missingReadings += 1;
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
