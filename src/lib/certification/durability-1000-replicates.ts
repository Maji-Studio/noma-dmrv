import { pluralize } from "@/lib/copy-utils";
import { MINIMUM_REPLICATES_PER_BATCH } from "@/lib/calculations/biochar-eligibility";
import { CARBON_RECONCILIATION_TOLERANCE_PERCENTAGE_POINTS } from "@/schemas/samples";
import { CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR } from "@/lib/isometric/transformers/measurement-sample";
import { transformSequestrationSourceValue } from "@/lib/isometric/transformers/sequestration-binding";

export interface Sampled1000YearMeasurement {
  id: string;
  sampleCode: string;
  totalCarbonPercent: number | null;
  inorganicCarbonPercent: number | null;
  sReflectanceFraction: number | null;
}

export interface Complete1000YearReplicate {
  sampleId: string;
  sampleCode: string;
  totalCarbonContentFraction: number;
  inorganicCarbonContentFraction: number;
  sFraction: number;
}

export interface Sampled1000YearReplicateEvaluation {
  replicates: Complete1000YearReplicate[];
  blockers: string[];
}

function isUsableNumber(value: number | null): value is number {
  return value != null && Number.isFinite(value);
}

function sampleLabels(
  samples: Sampled1000YearMeasurement[],
  predicate: (sample: Sampled1000YearMeasurement) => boolean,
): string[] {
  return samples
    .filter(predicate)
    .map((sample) => sample.sampleCode || sample.id)
    .sort((left, right) => left.localeCompare(right));
}

function missingMeasurementBlocker(args: {
  creditBatchCode: string;
  labels: string[];
  measurement: string;
}): string | null {
  if (args.labels.length === 0) return null;
  return (
    `Credit batch ${args.creditBatchCode} has ${args.labels.length} ` +
    `${pluralize(args.labels.length, "Sample")} missing ${args.measurement}: ` +
    `${args.labels.join(", ")}. Record the measured value on every Sample before submitting a 1,000-year Removal.`
  );
}

/**
 * Evaluates the exact same-sample tuple used by the current 1,000-year wire
 * contract. Missing or invalid rows are never silently dropped: blockers name
 * the affected Samples, while the returned replicates contain only valid rows.
 */
export function evaluateSampled1000YearReplicates(args: {
  creditBatchCode: string;
  samples: Sampled1000YearMeasurement[];
}): Sampled1000YearReplicateEvaluation {
  const orderedSamples = [...args.samples].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const blockers = [
    missingMeasurementBlocker({
      creditBatchCode: args.creditBatchCode,
      labels: sampleLabels(
        orderedSamples,
        (sample) => !isUsableNumber(sample.totalCarbonPercent),
      ),
      measurement: "total carbon",
    }),
    missingMeasurementBlocker({
      creditBatchCode: args.creditBatchCode,
      labels: sampleLabels(
        orderedSamples,
        (sample) => !isUsableNumber(sample.inorganicCarbonPercent),
      ),
      measurement: "measured inorganic carbon",
    }),
    missingMeasurementBlocker({
      creditBatchCode: args.creditBatchCode,
      labels: sampleLabels(
        orderedSamples,
        (sample) => !isUsableNumber(sample.sReflectanceFraction),
      ),
      measurement: "the R₀ fraction at or above 2%",
    }),
  ].filter((blocker): blocker is string => blocker != null);

  const invalidInorganicLabels = sampleLabels(
    orderedSamples,
    (sample) =>
      isUsableNumber(sample.inorganicCarbonPercent) &&
      sample.inorganicCarbonPercent < 0,
  );
  if (invalidInorganicLabels.length > 0) {
    blockers.push(
      `Credit batch ${args.creditBatchCode} has negative inorganic carbon on ${invalidInorganicLabels.join(", ")}. Correct the measured value before submitting.`,
    );
  }

  const excessiveInorganicLabels = sampleLabels(
    orderedSamples,
    (sample) =>
      isUsableNumber(sample.totalCarbonPercent) &&
      isUsableNumber(sample.inorganicCarbonPercent) &&
      sample.inorganicCarbonPercent - sample.totalCarbonPercent >
        CARBON_RECONCILIATION_TOLERANCE_PERCENTAGE_POINTS,
  );
  if (excessiveInorganicLabels.length > 0) {
    blockers.push(
      `Credit batch ${args.creditBatchCode} has inorganic carbon above total carbon beyond the ${CARBON_RECONCILIATION_TOLERANCE_PERCENTAGE_POINTS}-percentage-point tolerance on ${excessiveInorganicLabels.join(", ")}. Correct the carbon measurements before submitting.`,
    );
  }

  const replicates = orderedSamples.flatMap((sample) => {
    if (
      !isUsableNumber(sample.totalCarbonPercent) ||
      !isUsableNumber(sample.inorganicCarbonPercent) ||
      !isUsableNumber(sample.sReflectanceFraction) ||
      sample.inorganicCarbonPercent < 0 ||
      sample.inorganicCarbonPercent - sample.totalCarbonPercent >
        CARBON_RECONCILIATION_TOLERANCE_PERCENTAGE_POINTS
    ) {
      return [];
    }
    return [
      {
        sampleId: sample.id,
        sampleCode: sample.sampleCode,
        totalCarbonContentFraction: transformSequestrationSourceValue(
          CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR,
          "total_carbon_contents",
          sample.totalCarbonPercent,
        ),
        inorganicCarbonContentFraction: transformSequestrationSourceValue(
          CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR,
          "inorganic_carbon_contents",
          sample.inorganicCarbonPercent,
        ),
        sFraction: transformSequestrationSourceValue(
          CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR,
          "s_fraction",
          sample.sReflectanceFraction,
        ),
      },
    ];
  });

  if (replicates.length < MINIMUM_REPLICATES_PER_BATCH) {
    blockers.push(
      `Credit batch ${args.creditBatchCode} has ${replicates.length} complete 1,000-year ${pluralize(replicates.length, "replicate")}. Record total carbon, measured inorganic carbon, and the R₀ fraction on at least ${MINIMUM_REPLICATES_PER_BATCH} Samples before submitting.`,
    );
  }

  return { replicates, blockers };
}
