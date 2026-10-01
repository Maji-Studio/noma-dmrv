/**
 * Shapes for the energy estimate (ADR 0031): what the data-access read loads,
 * and the breakdown the attribution returns to the page.
 *
 * Every day is a facility-local `YYYY-MM-DD` string. Every activity reading is
 * nullable: null is a missing reading, never zero.
 */
import type { EnergySourceKey, SourceAmounts } from "./sources";

/** kg CO2e per activity unit, configured per facility. */
export interface EnergyFactors {
  dieselKgCo2ePerLitre: number;
  gridKgCo2ePerKwh: number;
  roadFreightKgCo2ePerTonneKm: number;
}

// ------------------------------------------------------------------ inputs

export interface EnergyRunInput {
  id: string;
  code: string;
  /** Facility day of the run start. */
  day: string;
  reactorName: string | null;
  creditBatchId: string | null;
  dieselOperationLiters: number | null;
  dieselGensetLiters: number | null;
  preprocessingFuelLiters: number | null;
  electricityKwh: number | null;
  /** 0 to 100. Null counts as no low-carbon share. */
  lowCarbonPercentage: number | null;
  biocharDryMassKg: number | null;
}

export interface EnergyTransportLegInput {
  /** One way. The round trip is applied where the distance is counted. */
  distanceKm: number;
  loadMassKg: number | null;
}

export interface EnergyFeedstockInput {
  id: string;
  code: string;
  /** Facility day of the receipt. */
  day: string;
  wetMassKg: number | null;
  legs: EnergyTransportLegInput[];
}

/** Wet feedstock a run drew from one feedstock. */
export interface EnergyFeedstockDrawInput {
  runId: string;
  feedstockId: string;
  wetMassKg: number;
}

export interface EnergyDeliveryInput {
  id: string;
  code: string;
  day: string;
  customerName: string | null;
  /** One way, override or customer location distance. */
  effectiveDistanceKm: number | null;
  deliveredWetMassKg: number | null;
  massDryKg: number | null;
}

export interface EnergyApplicationInput {
  id: string;
  code: string;
  day: string;
  deliveryId: string;
  dryMassKg: number | null;
  fieldName: string | null;
}

/** Dry biochar a delivery or application carried from one production run. */
export interface EnergyRunShareInput {
  ownerId: string;
  runId: string;
  dryMassKg: number;
}

export interface EnergyCreditBatchInput {
  id: string;
  code: string;
  startDate: string;
  endDate: string;
  status: string;
}

export interface EnergyInputs {
  runs: EnergyRunInput[];
  feedstocks: EnergyFeedstockInput[];
  feedstockDraws: EnergyFeedstockDrawInput[];
  deliveries: EnergyDeliveryInput[];
  deliveryRunShares: EnergyRunShareInput[];
  applications: EnergyApplicationInput[];
  applicationRunShares: EnergyRunShareInput[];
  creditBatches: EnergyCreditBatchInput[];
}

// ----------------------------------------------------------------- outputs

export type EnergyRecordScope = "batch" | "run" | "delivery" | "application";

export type ReadingGapUnit = "run" | "feedstock" | "delivery";

/** "Not recorded on `missing` of `of` runs" for one source of one record. */
export interface ReadingGap {
  missing: number;
  of: number;
  unit: ReadingGapUnit;
}

export interface EnergyFootprint {
  /** Recorded activity per source, scaled to the record's share. */
  activity: SourceAmounts;
  /** Estimated kg CO2e per source; null when the facility has no factors. */
  kg: SourceAmounts | null;
  gaps: Partial<Record<EnergySourceKey, ReadingGap>>;
}

export interface EnergyRecord {
  id: string;
  scope: EnergyRecordScope;
  code: string;
  /** Reactor, customer or field; null when none is recorded. */
  context: string | null;
  day: string;
  /** Credit batches only: the last day of the batch. */
  endDay: string | null;
  /** Credit batches this record's figures touch. */
  creditBatchIds: string[];
  footprint: EnergyFootprint;
  /** Production runs behind the figures. */
  runCount: number;
  /** Deliveries behind the transport figure. */
  deliveryCount: number;
  /** Dry biochar the record produced, carried or applied. */
  dryMassKg: number | null;
}

/** One dated piece of the facility's energy, for the summary and the flow. */
export interface EnergyFlow {
  source: EnergySourceKey;
  creditBatchId: string | null;
  day: string;
  activity: number;
  kg: number | null;
}

/** One missing reading, dated like the flow it would have been. */
export interface EnergyGap {
  source: EnergySourceKey;
  creditBatchIds: string[];
  day: string;
  recordId: string;
}

export interface EnergyProduction {
  creditBatchId: string | null;
  dryMassKg: number;
}

export interface EnergyPeriod {
  /** Null means from the first record. */
  from: string | null;
  to: string;
}

export interface EnergyBreakdown {
  /** Resolved period start: the first record day for all time. */
  from: string;
  to: string;
  factors: EnergyFactors | null;
  /** Every credit batch of the facility; the page filters by period. */
  creditBatches: EnergyCreditBatchInput[];
  /** Records in the period, every scope. */
  records: EnergyRecord[];
  flows: EnergyFlow[];
  gaps: EnergyGap[];
  /** Dry biochar produced by runs in the period. */
  production: EnergyProduction[];
}
