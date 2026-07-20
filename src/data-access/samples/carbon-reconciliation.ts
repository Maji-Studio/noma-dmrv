/**
 * Carbon reconciliation guard for sample writes.
 *
 * The update schema's superRefine can only see the fields present in a patch,
 * so a partial update (organic-only) would otherwise persist organic > total
 * against the stored total. This asserts the invariant on the EFFECTIVE state
 * (stored ∪ patch) instead, and is called twice in updateSample: once as a
 * fast-fail pre-check, then again inside the transaction against the row
 * locked FOR UPDATE, which is what actually closes the concurrent-update race.
 *
 * The merge MUST use `!== undefined`, never `"key" in data`: src/fn/samples.ts
 * builds its payload as an object literal that spells out all three carbon
 * keys, so every key is always *present* even when its value is undefined.
 * An `in` check is therefore always true, the fallback to the stored row
 * becomes dead code, and the guard silently no-ops for every real caller.
 * `assertDryMassBalance` in ../production-runs/mutations.ts merges the same way.
 */
import type { samples } from "@/db/schema";
import { SafeError } from "@/lib/errors";
import { CARBON_RECONCILIATION_TOLERANCE_PERCENTAGE_POINTS } from "@/schemas/samples";

export function assertCarbonReconciliation(
  existing: Pick<
    typeof samples.$inferSelect,
    | "totalCarbonPercent"
    | "organicCarbonPercent"
    | "inorganicCarbonPercent"
  >,
  data: Partial<
    Pick<
      typeof samples.$inferSelect,
      | "totalCarbonPercent"
      | "organicCarbonPercent"
      | "inorganicCarbonPercent"
    >
  >,
): void {
  const total =
    data.totalCarbonPercent !== undefined
      ? data.totalCarbonPercent
      : existing.totalCarbonPercent;
  const organic =
    data.organicCarbonPercent !== undefined
      ? data.organicCarbonPercent
      : existing.organicCarbonPercent;
  const inorganic =
    data.inorganicCarbonPercent !== undefined
      ? data.inorganicCarbonPercent
      : existing.inorganicCarbonPercent;
  if (
    total != null &&
    organic != null &&
    organic - total > CARBON_RECONCILIATION_TOLERANCE_PERCENTAGE_POINTS
  ) {
    throw new SafeError(
      `Organic carbon cannot exceed total carbon by more than ${CARBON_RECONCILIATION_TOLERANCE_PERCENTAGE_POINTS} percentage points`,
    );
  }
  if (
    total != null &&
    organic != null &&
    inorganic != null &&
    organic + inorganic - total >
      CARBON_RECONCILIATION_TOLERANCE_PERCENTAGE_POINTS
  ) {
    throw new SafeError(
      `Organic plus inorganic carbon cannot exceed total carbon by more than ${CARBON_RECONCILIATION_TOLERANCE_PERCENTAGE_POINTS} percentage points`,
    );
  }
}
