/**
 * Pure builder: a removal's credit-batch durability data → Durability Evidence
 * Ledger view model.
 *
 * No I/O, no clock reads (generatedAtIso is injected). The submitted mean ±
 * std-dev figures come from `buildPerBatchDurabilityData` — the SAME aggregation
 * the measurement-sample POST uses — so the ledger reconciles exactly to what's
 * submitted. The raw replicate rows are the batch's pooled lab Samples; the
 * eligibility verdict reuses `evaluateRunEligibility` (the protocol §3 Table 2
 * gate). Inorganic carbon per replicate mirrors `replicateInorganicCarbon`
 * (measured, else Eq.2-derived) so the displayed rows feed the submitted mean.
 */
import { evaluateRunEligibility } from "@/lib/calculations/biochar-eligibility";
import { selectTwoHundredYearLedgerSamples } from "./input-selection";
export { samplingDayOf } from "./input-selection";
import {
  buildPerBatchDurabilityData,
  type CreditBatchDurabilityInput,
  type FacilityReferenceSoilTemperature,
  type ValueWithStdDev,
} from "@/lib/isometric/utils/durability-aggregation";
import type {
  DurabilityLedgerModel,
  LedgerBatch,
  LedgerReplicate,
  LedgerStat,
} from "./durability-types";

export interface BuildDurabilityLedgerModelArgs {
  /** The removal's member credit batches with pooled Samples + applied runs. */
  batches: (CreditBatchDurabilityInput & {
    endDate?: string | null;
    /** IANA facility timezone — classifies sampling instants by local day. */
    facilityTimezone?: string | null;
  })[];
  /** Per-run applied-biochar fraction (scales each batch's product mass). */
  attributionByRunId: Map<string, number>;
  /** Facility reference soil temperature (7 °C-floored; non-null past the gate). */
  facilityReferenceSoilTemperature: FacilityReferenceSoilTemperature;
  memberBatchCodes: string | null;
  facilityName: string | null;
  externalProjectId: string | null;
  generatedAtIso: string;
}

function statOf(value: ValueWithStdDev | null): LedgerStat | null {
  return value == null ? null : { mean: value.mean, stdDev: value.stdDev };
}

type SelectedSample = ReturnType<typeof selectTwoHundredYearLedgerSamples>["samples"][number];

function buildReplicate({ sample, input }: SelectedSample, index: number): LedgerReplicate {
  const derived = input.inorganicCarbonPercent === null && input.totalCarbonPercent !== null && input.organicCarbonPercent !== null;
  const inorganic = derived ? Math.max(0, input.totalCarbonPercent! - input.organicCarbonPercent!) : input.inorganicCarbonPercent;
  return {
    ref: `R${index + 1}`, sampleCode: sample.sampleCode,
    samplingDay: input.samplingDay ?? null, labName: sample.labName ?? null,
    hToCorg: input.hToCOrgRatio, oToCorg: input.oToCOrgRatio,
    totalCarbonPercent: input.totalCarbonPercent, organicCarbonPercent: input.organicCarbonPercent,
    inorganicCarbonPercent: inorganic, inorganicDerived: derived,
  };
}

export function buildDurabilityLedgerModel(
  args: BuildDurabilityLedgerModelArgs,
): DurabilityLedgerModel {
  const perBatch = buildPerBatchDurabilityData(
    args.batches,
    args.attributionByRunId,
  );
  const samplesByBatchId = new Map(
    args.batches.map((b) => [b.creditBatchId, b.samples]),
  );
  const timezoneByBatchId = new Map(
    args.batches.map((b) => [b.creditBatchId, b.facilityTimezone ?? null]),
  );

  const batches: LedgerBatch[] = [];
  for (const dp of perBatch) {
    const samples = samplesByBatchId.get(dp.creditBatchId) ?? [];
    const facilityTimezone = timezoneByBatchId.get(dp.creditBatchId) ?? null;
    const selected = selectTwoHundredYearLedgerSamples(samples, facilityTimezone);
    // Unsampled batches submit through Method B and have no ledger row.
    if (!selected.replicates.length || dp.hToCorgRatio == null) continue;
    const eligibility = evaluateRunEligibility(selected.samples.map(({ input }) => input));
    const oValues = selected.samples.flatMap(({ input }) => input.oToCOrgRatio === null ? [] : [input.oToCOrgRatio]);

    batches.push({
      creditBatchId: dp.creditBatchId,
      creditBatchCode: dp.creditBatchCode,
      replicates: selected.replicates.map((s, index) =>
        buildReplicate(s, index),
      ),
      replicateCount: dp.replicateCount,
      hToCorg: { mean: dp.hToCorgRatio.mean, stdDev: dp.hToCorgRatio.stdDev },
      totalCarbonPercent: statOf(dp.totalCarbonPercent),
      inorganicCarbonPercent: statOf(dp.inorganicCarbonPercent),
      oToCorg: meanAndStdDevStat(oValues),
      productMassKg: dp.productMassKg,
      eligibility: {
        hToCorgMean: eligibility.meanHToCOrgRatio,
        oToCorgMean: eligibility.meanOToCOrgRatio,
        hToCWithinThreshold: eligibility.hToCWithinThreshold,
        oToCWithinThreshold: eligibility.oToCWithinThreshold,
        eligible: eligibility.eligible,
      },
    });
  }

  const soil = args.facilityReferenceSoilTemperature;
  return {
    memberBatchCodes: args.memberBatchCodes,
    facilityName: args.facilityName,
    externalProjectId: args.externalProjectId,
    generatedAtIso: args.generatedAtIso,
    batches,
    soil: {
      declaredSoilTemperatureC: soil.declaredSoilTemperatureC,
      effectiveSoilTemperatureC: soil.effectiveSoilTemperatureC,
      temperatureFloored: soil.temperatureFloored,
      source: soil.source,
      method: soil.method,
    },
    eligibleBatchCount: batches.filter((b) => b.eligibility.eligible === true)
      .length,
    totalReplicates: batches.reduce((sum, b) => sum + b.replicateCount, 0),
  };
}

// O/C_org mean ± std-dev — the eligibility gate's second ratio. Shown for
// completeness (it is not a submitted measurement-sample value, only H/C_org +
// carbon + mass are). Local to keep the durability aggregation surface lean.
function meanAndStdDevStat(values: number[]): LedgerStat | null {
  if (values.length === 0) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (values.length < 2) return { mean, stdDev: null };
  const variance =
    values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (values.length - 1);
  return { mean, stdDev: Math.sqrt(variance) };
}
