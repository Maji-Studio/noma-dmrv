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
import { formatFacilityDate, formatUtcDate } from "@/lib/date-utils";
import {
  countDistinctProvenance,
  normalizePostWindowSamplingDay,
} from "@/lib/certification/durability-submission-gates";
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

function isUsableNumber(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value);
}

function statOf(value: ValueWithStdDev | null): LedgerStat | null {
  return value == null ? null : { mean: value.mean, stdDev: value.stdDev };
}

// ISO calendar day (YYYY-MM-DD) of a sampling timestamp, for the §8.3.1
// distribution evidence, resolved in the facility's local timezone so the
// ledger classifies a sampling instant on the SAME calendar day as the write
// guard and submission gate. Falls back to UTC only when the timezone is absent
// (light fixtures). Reads an existing Date/string — no clock access. Typed
// `unknown` because the column maps to `Date` but raw rows / test fixtures can
// carry a string.
function samplingDayOf(
  samplingTime: unknown,
  facilityTimezone: string | null | undefined,
): string | null {
  if (samplingTime instanceof Date) {
    return formatDayInZone(samplingTime, facilityTimezone);
  }
  if (typeof samplingTime === "string" && samplingTime.length >= 10) {
    // A timestamp string (carries a time/offset component) must resolve through
    // the SAME facility/UTC branch as a Date — otherwise an offset-bearing value
    // like `2026-01-15T03:30:00.000Z` slices to the UTC day and diverges from the
    // Date-backed local day. A bare date-only string is already a calendar day.
    if (samplingTime.includes("T")) {
      const parsed = new Date(samplingTime);
      if (!Number.isNaN(parsed.getTime())) {
        return formatDayInZone(parsed, facilityTimezone);
      }
    }
    return samplingTime.slice(0, 10);
  }
  return null;
}

/** Format a Date as its YYYY-MM-DD calendar day in the facility zone (UTC fallback). */
function formatDayInZone(
  date: Date,
  facilityTimezone: string | null | undefined,
): string | null {
  const day = facilityTimezone
    ? formatFacilityDate(date, facilityTimezone)
    : formatUtcDate(date);
  return day || null;
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

function buildReplicate(
  s: Sample,
  index: number,
  facilityTimezone: string | null | undefined,
): LedgerReplicate {
  const inorganic = replicateInorganic(s);
  return {
    ref: `R${index + 1}`,
    sampleCode: s.sampleCode,
    samplingDay: samplingDayOf(s.samplingTime, facilityTimezone),
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
// Delegates to the gate's OWN counter with the gate's OWN post-window
// normalization, so the ledger count can never diverge from what the gate credits.
function distinctRunDayCount(
  samples: Sample[],
  endDate: string | null | undefined,
  facilityTimezone: string | null | undefined,
): number {
  return countDistinctProvenance(
    samples.map((s) => ({
      sampleCode: s.sampleCode,
      productionRunId: s.productionRunId,
      samplingDay: normalizePostWindowSamplingDay(
        samplingDayOf(s.samplingTime, facilityTimezone),
        endDate,
      ),
    })),
  );
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
  const endDateByBatchId = new Map(
    args.batches.map((b) => [b.creditBatchId, b.endDate ?? null]),
  );
  const timezoneByBatchId = new Map(
    args.batches.map((b) => [b.creditBatchId, b.facilityTimezone ?? null]),
  );

  const batches: LedgerBatch[] = [];
  for (const dp of perBatch) {
    // Unsampled batches (Method B only) carry no chemistry to reconcile — they
    // submit via the unsampled blueprint, so they have no ledger row.
    if (!dp.sampled || dp.hToCorgRatio == null) continue;

    const samples = samplesByBatchId.get(dp.creditBatchId) ?? [];
    const facilityTimezone = timezoneByBatchId.get(dp.creditBatchId) ?? null;
    // Render only the replicates that back the submitted figures so the ledger
    // can't show more rows than its own `replicateCount`/distinctRunDayCount claim:
    //   • rows + replicateCount → the H/C_org-usable set (dp.replicateCount is
    //     hValues.length in buildPerBatchDurabilityData);
    //   • distinctRunDayCount → the complete-chemistry (H + O) set, mirroring the
    //     §8.3.1 cluster gate's `usableProvenance` so an incomplete off-day
    //     sample can't inflate the distribution evidence; post-window days are
    //     normalized to null.
    const usableHReplicates = samples.filter((s) =>
      isUsableNumber(s.hToCOrgRatio),
    );
    const usablePairedReplicates = samples.filter(
      (s) => isUsableNumber(s.hToCOrgRatio) && isUsableNumber(s.oToCOrgRatio),
    );
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
      replicates: usableHReplicates.map((s, index) =>
        buildReplicate(s, index, facilityTimezone),
      ),
      replicateCount: dp.replicateCount,
      distinctRunDayCount: distinctRunDayCount(
        usablePairedReplicates,
        endDateByBatchId.get(dp.creditBatchId),
        facilityTimezone,
      ),
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
