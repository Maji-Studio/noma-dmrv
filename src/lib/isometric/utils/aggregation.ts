import type { ProductionRun, Sample } from "@/db/schema";

export type ProductionRunWithSamples = ProductionRun & { samples: Sample[] };

export interface AggregatedProductionData {
  weightedOrganicCarbonPercent: number | null;
  weightedHToCorgRatio: number | null;
  weightedOToCorgRatio: number | null;
  weightedAshPercent: number | null;
  weightedMoisturePercent: number | null;
  totalBiocharDryMassKg: number;
  totalFeedstockDryMassKg: number;
  totalDieselLiters: number;
  totalElectricityKwh: number;
  earliestStartTime: Date;
  latestEndTime: Date;
  sourceProductionRunIds: string[];
  warnings: string[];
}

export function aggregateProductionRuns(
  runs: ProductionRunWithSamples[],
): AggregatedProductionData {
  if (runs.length === 0) {
    throw new Error("aggregateProductionRuns: no production runs supplied");
  }

  const warnings: string[] = [];
  const sourceProductionRunIds = runs.map((r) => r.id);

  let totalBiocharDryMassKg = 0;
  let totalFeedstockDryMassKg = 0;
  let totalDieselLiters = 0;
  let totalElectricityKwh = 0;
  let earliestStartTime = runs[0].startTime;
  let latestEndTime = runs[0].endTime;

  for (const run of runs) {
    totalBiocharDryMassKg += nz(run.biocharDryMassKg);
    totalFeedstockDryMassKg += nz(run.feedstockMassDryKg);
    totalDieselLiters +=
      nz(run.dieselOperationLiters) +
      nz(run.dieselGensetLiters) +
      nz(run.preprocessingFuelLiters);
    totalElectricityKwh += nz(run.electricityKwh);
    if (run.startTime < earliestStartTime) earliestStartTime = run.startTime;
    if (run.endTime > latestEndTime) latestEndTime = run.endTime;

    if (run.biocharDryMassKg == null) {
      warnings.push(`Run ${run.code}: missing biocharDryMassKg`);
    }
    if (run.samples.length === 0) {
      warnings.push(`Run ${run.code}: no samples`);
    }
  }

  return {
    weightedOrganicCarbonPercent: weightedAverage(
      runs,
      (s) => s.organicCarbonPercent,
    ),
    weightedHToCorgRatio: weightedAverage(runs, (s) => s.hToCOrgRatio),
    weightedOToCorgRatio: weightedAverage(runs, (s) => s.oToCOrgRatio),
    weightedAshPercent: weightedAverage(runs, (s) => s.ashContentPercent),
    weightedMoisturePercent: weightedAverage(
      runs,
      (s) => s.moistureContentPercent,
    ),
    totalBiocharDryMassKg,
    totalFeedstockDryMassKg,
    totalDieselLiters,
    totalElectricityKwh,
    earliestStartTime,
    latestEndTime,
    sourceProductionRunIds,
    warnings,
  };
}

// Mass-weighted by run.biocharDryMassKg using the per-run mean of `pick`
// across that run's samples. Runs with no usable samples or zero mass are
// dropped from both numerator and denominator.
function weightedAverage(
  runs: ProductionRunWithSamples[],
  pick: (s: Sample) => number | null,
): number | null {
  let weightSum = 0;
  let weighted = 0;
  for (const run of runs) {
    const mass = run.biocharDryMassKg;
    if (mass == null || mass <= 0) continue;
    const values = run.samples
      .map(pick)
      .filter((v): v is number => v != null && Number.isFinite(v));
    if (values.length === 0) continue;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    weighted += mean * mass;
    weightSum += mass;
  }
  return weightSum === 0 ? null : weighted / weightSum;
}

function nz(value: number | null | undefined): number {
  return value == null ? 0 : value;
}

export interface ResolvedTemplateInput {
  removalTemplateComponentId: string;
  inputKey: string;
  type: "fixed" | "monitored";
  preboundDatapointId: string | null;
  componentBlueprintKey: string;
}

export interface MissingInput {
  removalTemplateComponentId: string;
  inputKey: string;
  reason: string;
}

// Walks the resolved template's monitored inputs (delegated by caller) and
// reports which can't be served by `agg`. INPUT_MAPPING covers the link from
// inputKey → AggregatedProductionData field; this function checks both presence
// in the mapping and a non-null source value.
export function validateForTemplate(
  agg: AggregatedProductionData,
  monitoredInputs: ResolvedTemplateInput[],
  inputMapping: Record<string, { source: keyof AggregatedProductionData }>,
): { ok: true } | { ok: false; missing: MissingInput[] } {
  const missing: MissingInput[] = [];
  for (const input of monitoredInputs) {
    if (input.type !== "monitored") continue;
    const map = inputMapping[input.inputKey];
    if (!map) {
      missing.push({
        removalTemplateComponentId: input.removalTemplateComponentId,
        inputKey: input.inputKey,
        reason: `No INPUT_MAPPING entry for "${input.inputKey}"`,
      });
      continue;
    }
    const value = agg[map.source];
    if (value == null) {
      missing.push({
        removalTemplateComponentId: input.removalTemplateComponentId,
        inputKey: input.inputKey,
        reason: `Aggregated source ${String(map.source)} is null`,
      });
    }
  }
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}
