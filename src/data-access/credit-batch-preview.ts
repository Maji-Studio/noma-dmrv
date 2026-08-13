import type { CreditBatch } from "@/db/schema";
import { certifierProjects } from "@/db/schema";
import { MINIMUM_REPLICATES_PER_BATCH } from "@/lib/calculations/biochar-eligibility";
import {
  BLUEPRINT_1000_YEAR_REPLICATES_INPUT,
  type Blueprint1000YearReplicate,
} from "@/lib/calculations/biochar-removal";
import { evaluateSampled1000YearReplicates } from "@/lib/certification/durability-1000-replicates";
import type { DurabilityOption } from "@/schemas/credit-batches";

export type CertifierProvider =
  (typeof certifierProjects.$inferSelect)["provider"];

export interface ApplicationCo2eStoredPreview {
  applicationId: string;
  applicationCode: string;
  co2eStoredTonnes: number | null;
  /** Uncapped registry-component estimate, when the active path exposes it. */
  rawFDurable: number | null;
  /** Final durability used in the stored-CO₂e preview. */
  fDurable: number | null;
  durabilityCapped: boolean;
  organicCarbonPercent: number | null;
  effectiveSoilTemperatureC: number | null;
  missingInputs: string[];
  warnings: string[];
}

export interface CreditBatchCo2eStoredPreview {
  provider: CertifierProvider | null;
  co2eStoredTonnes: number | null;
  /** Registry component this local explanation mirrors, when applicable. */
  componentKey: string | null;
  moduleVersion: string | null;
  /** Local explanatory formula contract; never an authoritative registry result. */
  formulaVersion: string | null;
  applicationResults: ApplicationCo2eStoredPreview[];
  missingInputs: string[];
  warnings: string[];
}

export interface Preview1000YearSample {
  totalCarbonPercent: number | null;
  inorganicCarbonPercent: number | null;
  sReflectanceFraction: number | null;
}

/** Extract the same complete, validated replicate tuples as submission. */
export function extract1000YearBlueprintReplicates(
  batchSamples: Preview1000YearSample[],
): Blueprint1000YearReplicate[] {
  const evaluation = evaluateSampled1000YearReplicates({
    creditBatchCode: "preview",
    samples: batchSamples.map((sample, index) => ({
      id: String(index),
      sampleCode: `Sample ${index + 1}`,
      ...sample,
    })),
  });
  return evaluation.replicates.map((replicate) => ({
    totalCarbonPercent: replicate.totalCarbonContentFraction * 100,
    inorganicCarbonPercent:
      replicate.inorganicCarbonContentFraction * 100,
    sReflectanceFraction: replicate.sFraction,
  }));
}

/** Batch chemistry gaps that remain even when there is no application mass. */
export function independentPreviewMissingInputs(
  batch: Pick<CreditBatch, "sampling"> & {
    durabilityOption: DurabilityOption;
  },
  batchSamples: Preview1000YearSample[],
): string[] {
  const completeReplicateCount =
    extract1000YearBlueprintReplicates(batchSamples).length;
  if (
    batch.sampling === "sampled" &&
    batch.durabilityOption === "1000_year" &&
    (completeReplicateCount < MINIMUM_REPLICATES_PER_BATCH ||
      completeReplicateCount !== batchSamples.length)
  ) {
    return [BLUEPRINT_1000_YEAR_REPLICATES_INPUT];
  }
  return [];
}
