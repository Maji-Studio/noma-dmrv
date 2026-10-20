import type { BatchLineageApplicationFact } from "@/data-access/credit-batch-lineage-types";

/** Σ the slices' dry mass; null with no slices or any unknown slice, never a partial sum. */
export function deriveAppliedDryTons(
  applications: readonly Pick<BatchLineageApplicationFact, "biocharAppliedDryTons">[],
): number | null {
  if (applications.length === 0) return null;

  let total = 0;
  for (const application of applications) {
    if (application.biocharAppliedDryTons === null) return null;
    total += application.biocharAppliedDryTons;
  }
  return total;
}
