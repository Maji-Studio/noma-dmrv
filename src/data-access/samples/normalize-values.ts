import { normalizeRealUnderflow } from "@/db/schema/real-column";
import type { CreateSampleRequest, UpdateSampleRequest } from "./write-values";

const REAL_FIELDS = [
  "weightGrams", "volumeMl", "totalCarbonPercent", "inorganicCarbonPercent", "organicCarbonPercent",
  "totalHydrogenPercent", "totalNitrogenPercent", "totalOxygenPercent", "totalSulfurPercent",
  "ashContentPercent", "moistureContentPercent", "ph", "bulkDensityKgPerM3", "saltContentGPerKg",
  "phosphorusPercent", "potassiumPercent", "magnesiumPercent", "calciumPercent", "ironPercent",
  "randomReflectanceR0Percent", "reactiveCarbonPercent", "residualCarbonPercent", "sReflectanceFraction",
] as const satisfies readonly (keyof CreateSampleRequest)[];

/** Normalize stored real inputs before merging, derivation, reconciliation and warnings. */
export function normalizeSampleRealValues<T extends CreateSampleRequest | UpdateSampleRequest>(request: T): T {
  const normalized = { ...request };
  for (const field of REAL_FIELDS) {
    const value = request[field];
    if (typeof value === "number") normalized[field] = normalizeRealUnderflow(value);
  }
  return normalized;
}
