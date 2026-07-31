import { CARBON_RECONCILIATION_TOLERANCE_PERCENTAGE_POINTS } from "@/schemas/samples";

export const ORGANIC_CARBON_EXCEEDS_TOTAL_MESSAGE =
  "Organic carbon exceeds total carbon.";
export const COMBINED_CARBON_EXCEEDS_TOTAL_MESSAGE =
  "Organic and inorganic carbon exceed total carbon.";

interface SampleCarbonValues {
  totalCarbonPercent?: number | null;
  organicCarbonPercent?: number | null;
  inorganicCarbonPercent?: number | null;
}

interface SampleCarbonReconciliationErrors {
  organicCarbonPercent?: string;
  inorganicCarbonPercent?: string;
}

function isCompleteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function getSampleCarbonReconciliationErrors(
  values: SampleCarbonValues,
): SampleCarbonReconciliationErrors {
  const errors: SampleCarbonReconciliationErrors = {};
  const { totalCarbonPercent, organicCarbonPercent, inorganicCarbonPercent } =
    values;

  if (
    isCompleteNumber(totalCarbonPercent) &&
    isCompleteNumber(organicCarbonPercent) &&
    organicCarbonPercent - totalCarbonPercent >
      CARBON_RECONCILIATION_TOLERANCE_PERCENTAGE_POINTS
  ) {
    errors.organicCarbonPercent = ORGANIC_CARBON_EXCEEDS_TOTAL_MESSAGE;
  }

  if (
    isCompleteNumber(totalCarbonPercent) &&
    isCompleteNumber(organicCarbonPercent) &&
    isCompleteNumber(inorganicCarbonPercent) &&
    organicCarbonPercent + inorganicCarbonPercent - totalCarbonPercent >
      CARBON_RECONCILIATION_TOLERANCE_PERCENTAGE_POINTS
  ) {
    errors.inorganicCarbonPercent = COMBINED_CARBON_EXCEEDS_TOTAL_MESSAGE;
  }

  return errors;
}
