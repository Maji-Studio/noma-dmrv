/**
 * The figures the Removal sheet shows beside its credit batches (#1554): the
 * batch links, dry mass, a local CO₂e estimate, durability and sampling.
 * Pure projection so the read and its tests share one reading.
 */
import type { DurabilityOption } from "@/schemas/credit-batches";

export interface RemovalSheetBatchInput {
  id: string;
  code: string;
  durabilityOption: DurabilityOption;
  sampling: string;
  /** Dry tonnes applied in this Removal's scope; null when any application has no dry mass or there is none. */
  appliedDryTons: number | null;
  co2eStoredTonnes: number | null;
}

export interface RemovalSheetFacts {
  batches: { id: string; code: string }[];
  facilityName: string | null;
  /** Dry tonnes; null unless every batch reports one, so the field can read "not yet computed". */
  dryTonnes: number | null;
  /** Sum of the credit batches' local estimates; null unless every batch has one. */
  co2eEstimateTonnes: number | null;
  /** "200-year (H:Corg)", or several when the batches differ; null with no batch. */
  durabilityLabel: string | null;
  samplingLabel: string | null;
}

const DURABILITY_LABELS: Record<DurabilityOption, string> = {
  "200_year": "200-year (H:Corg)",
  "1000_year": "1000-year (R₀ reflectance)",
};

const labels = (values: string[]) => (values.length === 0 ? null : [...new Set(values)].join(", "));

export function projectRemovalSheetFacts(batches: RemovalSheetBatchInput[], facilityName: string | null): RemovalSheetFacts {
  const sorted = [...batches].sort((a, b) => a.code.localeCompare(b.code));
  const dry = sorted.map((batch) => batch.appliedDryTons);
  const estimates = sorted.map((batch) => batch.co2eStoredTonnes);
  return {
    batches: sorted.map(({ id, code }) => ({ id, code })),
    facilityName,
    dryTonnes: sorted.length > 0 && dry.every((value): value is number => value != null)
      ? dry.reduce((sum, value) => sum + value, 0)
      : null,
    co2eEstimateTonnes: sorted.length > 0 && estimates.every((value): value is number => value != null)
      ? estimates.reduce((sum, value) => sum + value, 0)
      : null,
    durabilityLabel: labels(sorted.map((batch) => DURABILITY_LABELS[batch.durabilityOption])),
    samplingLabel: labels(sorted.map((batch) => (batch.sampling === "sampled" ? "Sampled" : "Not sampled"))),
  };
}
