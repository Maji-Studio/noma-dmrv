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
import { SampleFieldError } from "@/lib/sample-domain-errors";
import { getSampleCarbonReconciliationErrors, SAMPLE_CARBON_REFUSAL_FIELDS } from "@/schemas/samples";

export function assertCarbonReconciliation(
  existing: Pick<
    typeof samples.$inferSelect,
    | "totalCarbonPercent"
    | "organicCarbonPercent"
    | "inorganicCarbonPercent"
    | "reactiveCarbonPercent"
    | "residualCarbonPercent"
  >,
  data: Partial<
    Pick<
      typeof samples.$inferSelect,
      | "totalCarbonPercent"
      | "organicCarbonPercent"
      | "inorganicCarbonPercent"
      | "reactiveCarbonPercent"
      | "residualCarbonPercent"
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
  const reactive =
    data.reactiveCarbonPercent !== undefined
      ? data.reactiveCarbonPercent
      : existing.reactiveCarbonPercent;
  const residual =
    data.residualCarbonPercent !== undefined
      ? data.residualCarbonPercent
      : existing.residualCarbonPercent;
  const errors = getSampleCarbonReconciliationErrors({
    totalCarbonPercent: total,
    organicCarbonPercent: organic,
    inorganicCarbonPercent: inorganic,
    reactiveCarbonPercent: reactive,
    residualCarbonPercent: residual,
  });
  for (const field of SAMPLE_CARBON_REFUSAL_FIELDS) {
    const message = errors[field];
    if (message) throw new SampleFieldError(message, field);
  }
}
