import type { DurabilityOption } from "@/schemas/credit-batches";

/** Only 1000-year Removals capture Applications separately by credit batch. */
export function removalSplitsApplicationsByBatch(durabilityOption: DurabilityOption): boolean {
  return durabilityOption === "1000_year";
}
