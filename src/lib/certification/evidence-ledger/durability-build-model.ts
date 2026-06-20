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
import type { Sample } from "@/db/schema";
import { evaluateRunEligibility } from "@/lib/calculations/biochar-eligibility";
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
  batches: CreditBatchDurabilityInput[];
  /** Per-run applied-biochar fraction (scales each batch's product mass). */
  attributionByRunId: Map<string, number>;
  /** Facility reference soil temperature (7 °C-floored; non-null past the gate). */
  facilityReferenceSoilTemperature: FacilityReferenceSoilTemperature;
  memberBatchCodes: string | null;
  facilityName: string | null;
  externalProjectId: string | null;
  generatedAtIso: string;
}

function isUsableNumber(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value);
}

function statOf(value: ValueWithStdDev | null): LedgerStat | null {
  return value == null ? null : { mean: value.mean, stdDev: value.stdDev };
}

// ISO calendar day (YYYY-MM-DD) of a sampling timestamp, for the §8.3.1
// distribution evidence. Reads an existing Date/string — no clock access. Typed
// `unknown` because the column maps to `Date` but raw rows / test fixtures can
// carry a string.
function samplingDayOf(samplingTime: unknown): string | null {
  if (samplingTime instanceof Date) return samplingTime.toISOString().slice(0, 10);
  if (typeof samplingTime === "string" && samplingTime.length >= 10) {
    return samplingTime.slice(0, 10);
  }
  return null;
}

// Inorganic carbon for one replicate: prefer the measured value, else derive
// max(0, Total − Organic) per Eq.2 — mirrors `replicateInorganicCarbon` so the
// displayed rows reconcile to the submitted inorganic mean.
function replicateInorganic(s: Sample): {
  value: number | null;
  derived: boolean;
} {
  if (isUsableNumber(s.inorganicCarbonPercent)) {
    return { value: s.inorganicCarbonPercent, derived: false };
  }
  if (
    isUsableNumber(s.totalCarbonPercent) &&
    isUsableNumber(s.organicCarbonPercent)
  ) {
    return {
      value: Math.max(0, s.totalCarbonPercent - s.organicCarbonPercent),
      derived: true,
    };
  }
  return { value: null, derived: false };
}

function buildReplicate(s: Sample, index: number): LedgerReplicate {
  const inorganic = replicateInorganic(s);
  return {
    ref: `R${index + 1}`,
    sampleCode: s.sampleCode,
    samplingDay: samplingDayOf(s.samplingTime),
    labName: s.labName ?? null,
    hToCorg: isUsableNumber(s.hToCOrgRatio) ? s.hToCOrgRatio : null,
    oToCorg: isUsableNumber(s.oToCOrgRatio) ? s.oToCOrgRatio : null,
    totalCarbonPercent: isUsableNumber(s.totalCarbonPercent)
      ? s.totalCarbonPercent
      : null,
    organicCarbonPercent: isUsableNumber(s.organicCarbonPercent)
      ? s.organicCarbonPercent
      : null,
    inorganicCarbonPercent: inorganic.value,
    inorganicDerived: inorganic.derived,
  };
}

// Distinct (run, day) provenance keys among a batch's samples — the §8.3.1
// "distributed across distinct runs/days" evidence. Fully-null provenance can't
// be judged, so it doesn't add a distinct key (mirrors the gate's cluster check).
function distinctDayCount(samples: Sample[]): number {
  const keys = new Set<string>();
  for (const s of samples) {
    const day = samplingDayOf(s.samplingTime);
    if (s.productionRunId == null && day == null) continue;
    keys.add(`${s.productionRunId ?? "?"}::${day ?? "?"}`);
  }
  return keys.size;
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

  const batches: LedgerBatch[] = [];
  for (const dp of perBatch) {
    // Unsampled batches (Method B only) carry no chemistry to reconcile — they
    // submit via the unsampled blueprint, so they have no ledger row.
    if (!dp.sampled || dp.hToCorgRatio == null) continue;

    const samples = samplesByBatchId.get(dp.creditBatchId) ?? [];
    const eligibility = evaluateRunEligibility(
      samples.map((s) => ({
        hToCOrgRatio: s.hToCOrgRatio,
        oToCOrgRatio: s.oToCOrgRatio,
      })),
    );
    const oValues = samples
      .map((s) => s.oToCOrgRatio)
      .filter(isUsableNumber);

    batches.push({
      creditBatchId: dp.creditBatchId,
      creditBatchCode: dp.creditBatchCode,
      replicates: samples.map(buildReplicate),
      replicateCount: dp.replicateCount,
      distinctDayCount: distinctDayCount(samples),
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
