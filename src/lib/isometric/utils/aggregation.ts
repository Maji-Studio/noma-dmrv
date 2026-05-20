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
  // Mass-weighted distance per transport-leg category, such that Certify's
  // server-side `distance × Σmass × factor` equals Σⱼ(distⱼ × massⱼ × factor)
  // — compliant with Isometric Transportation v1.1 §5 when every leg in the
  // category shares the same method + emission factor. Mixed categories
  // surface a warning instead of a value (see `aggregateTransportLegs`).
  // Null when no legs are recorded OR when uniformity could not be
  // established. Caller populates via `enrichWithTransportLegs`.
  feedstockTransportAvgDistanceKm: number | null;
  biocharTransportAvgDistanceKm: number | null;
  sampleTransportAvgDistanceKm: number | null;
  earliestStartTime: Date;
  latestEndTime: Date;
  sourceProductionRunIds: string[];
  warnings: string[];
}

// Aggregates a category's transport legs into a single distance value such
// that Certify's `distance × Σmass × factor` server-side calculation equals
// the per-leg sum Σⱼ(distⱼ × massⱼ × factor) — i.e., compliant with Isometric
// Transportation v1.1 §5 ("Calculations shall be completed separately for
// each leg ... total emissions calculated by the sum of emissions from
// each leg"). This equivalence ONLY holds when every leg in the category
// shares the same calculation method and emission factor. Mixed factors
// break the linearity, so this function refuses to aggregate them and
// records a warning instead.
//
// Returns:
//   { distanceKm }                  — uniform legs, mass-weighted distance
//   { warning }                     — non-uniform, missing data, or empty
export interface TransportAggregationResult {
  distanceKm: number | null;
  warning: string | null;
}

const FACTOR_TOLERANCE = 1e-9;

export function aggregateTransportLegs(
  legs: TransportLeg[],
  categoryLabel: string,
): TransportAggregationResult {
  if (legs.length === 0) {
    return { distanceKm: null, warning: null };
  }

  // Every leg must carry the per-leg fields needed to verify uniformity and
  // to compute the mass-weighted sum. Unweighted means are non-compliant
  // (they would silently underweight large loads).
  for (const leg of legs) {
    if (leg.loadMassKg == null || leg.loadMassKg <= 0) {
      return {
        distanceKm: null,
        warning: `${categoryLabel} transport leg ${leg.id}: missing load_mass_kg — required for per-leg accounting`,
      };
    }
    if (leg.emissionFactorUsed == null) {
      return {
        distanceKm: null,
        warning: `${categoryLabel} transport leg ${leg.id}: missing emission_factor_used — required to verify per-leg uniformity (Isometric v1.1 §5)`,
      };
    }
  }

  const method = legs[0].calculationMethodType;
  const factor = legs[0].emissionFactorUsed as number;
  for (const leg of legs) {
    if (leg.calculationMethodType !== method) {
      return {
        distanceKm: null,
        warning: `${categoryLabel} transport legs mix calculation methods (${method} vs ${leg.calculationMethodType}); Isometric v1.1 §5 requires per-leg accounting. Submit separately or unify methods.`,
      };
    }
    if (
      Math.abs((leg.emissionFactorUsed as number) - factor) > FACTOR_TOLERANCE
    ) {
      return {
        distanceKm: null,
        warning: `${categoryLabel} transport legs mix emission factors (${factor} vs ${leg.emissionFactorUsed}); Isometric v1.1 §5 requires per-leg accounting. Submit separately or unify factors.`,
      };
    }
  }

  let weighted = 0;
  let weightSum = 0;
  for (const leg of legs) {
    const mass = leg.loadMassKg as number;
    weighted += leg.distanceKm * mass;
    weightSum += mass;
  }
  return { distanceKm: weighted / weightSum, warning: null };
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

// Layers transport-leg distances onto an existing aggregation result.
// Pure: returns a new object, doesn't mutate `agg`. Per-category warnings
// (mixed methods/factors, missing per-leg data) are appended to
// `agg.warnings`, which the submission pipeline short-circuits on.
export function enrichWithTransportLegs(
  agg: AggregatedProductionData,
  legs: TransportLegsByCategory,
): AggregatedProductionData {
  const feedstock = aggregateTransportLegs(legs.feedstock, "Feedstock");
  const biochar = aggregateTransportLegs(legs.biochar, "Biochar");
  const sample = aggregateTransportLegs(legs.sample, "Sample");
  const newWarnings = [
    feedstock.warning,
    biochar.warning,
    sample.warning,
  ].filter((w): w is string => w !== null);

  return {
    ...agg,
    feedstockTransportAvgDistanceKm: feedstock.distanceKm,
    biocharTransportAvgDistanceKm: biochar.distanceKm,
    sampleTransportAvgDistanceKm: sample.distanceKm,
    warnings: [...agg.warnings, ...newWarnings],
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
