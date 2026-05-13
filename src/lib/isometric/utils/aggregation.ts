import type { ProductionRun, Sample, TransportLeg } from "@/db/schema";

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
  // Mass-weighted average distance per transport-leg category. Null when no
  // legs are recorded for that category. Caller (submit-credit-batch.ts)
  // populates these by querying `transport_legs` along the lineage.
  feedstockTransportAvgDistanceKm: number | null;
  biocharTransportAvgDistanceKm: number | null;
  sampleTransportAvgDistanceKm: number | null;
  earliestStartTime: Date;
  latestEndTime: Date;
  sourceProductionRunIds: string[];
  warnings: string[];
}

// Mass-weighted average distance: Σ(distance × load_mass) / Σ(load_mass).
// Returns null when no legs are supplied or total load mass is zero/null.
// Legs with null load_mass_kg are skipped (don't contribute to either sum).
export function aggregateTransportLegs(legs: TransportLeg[]): number | null {
  if (legs.length === 0) return null;
  let weighted = 0;
  let weightSum = 0;
  for (const leg of legs) {
    if (leg.loadMassKg == null) continue;
    weighted += leg.distanceKm * leg.loadMassKg;
    weightSum += leg.loadMassKg;
  }
  return weightSum === 0 ? null : weighted / weightSum;
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
    // Transport distance fields default to null. Caller enriches via
    // `enrichWithTransportLegs` after fetching legs along the lineage.
    feedstockTransportAvgDistanceKm: null,
    biocharTransportAvgDistanceKm: null,
    sampleTransportAvgDistanceKm: null,
    earliestStartTime,
    latestEndTime,
    sourceProductionRunIds,
    warnings,
  };
}

export interface TransportLegsByCategory {
  feedstock: TransportLeg[];
  biochar: TransportLeg[];
  sample: TransportLeg[];
}

// Layers transport-leg averages onto an existing aggregation result.
// Pure: returns a new object, doesn't mutate `agg`.
export function enrichWithTransportLegs(
  agg: AggregatedProductionData,
  legs: TransportLegsByCategory,
): AggregatedProductionData {
  return {
    ...agg,
    feedstockTransportAvgDistanceKm: aggregateTransportLegs(legs.feedstock),
    biocharTransportAvgDistanceKm: aggregateTransportLegs(legs.biochar),
    sampleTransportAvgDistanceKm: aggregateTransportLegs(legs.sample),
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
  groupKey: string;
  removalTemplateComponentId: string;
  componentBlueprintKey: string;
  inputKey: string;
  type: "fixed" | "monitored";
  preboundDatapointId: string | null;
}

export interface MissingInput {
  groupKey: string;
  removalTemplateComponentId: string;
  inputKey: string;
  reason: string;
}

// Three-level nested INPUT_MAPPING shape passed in by the caller. Decouples
// this utility from the concrete `transformers/datapoint.ts` import.
type NestedInputMapping = Record<
  string,
  Record<
    string,
    Record<string, { source: keyof AggregatedProductionData }>
  >
>;

// Walks the resolved template's monitored inputs (delegated by caller) and
// reports which can't be served by `agg`. INPUT_MAPPING covers the link from
// (group, blueprint, input) → AggregatedProductionData field; this function
// checks both presence in the mapping and a non-null source value.
export function validateForTemplate(
  agg: AggregatedProductionData,
  monitoredInputs: ResolvedTemplateInput[],
  inputMapping: NestedInputMapping,
): { ok: true } | { ok: false; missing: MissingInput[] } {
  const missing: MissingInput[] = [];
  for (const input of monitoredInputs) {
    if (input.type !== "monitored") continue;
    const map =
      inputMapping[input.groupKey]?.[input.componentBlueprintKey]?.[
        input.inputKey
      ];
    if (!map) {
      missing.push({
        groupKey: input.groupKey,
        removalTemplateComponentId: input.removalTemplateComponentId,
        inputKey: input.inputKey,
        reason: `No INPUT_MAPPING entry for group="${input.groupKey}" blueprint="${input.componentBlueprintKey}" input="${input.inputKey}"`,
      });
      continue;
    }
    const value = agg[map.source];
    if (value == null) {
      missing.push({
        groupKey: input.groupKey,
        removalTemplateComponentId: input.removalTemplateComponentId,
        inputKey: input.inputKey,
        reason: `Aggregated source ${String(map.source)} is null`,
      });
    }
  }
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}
