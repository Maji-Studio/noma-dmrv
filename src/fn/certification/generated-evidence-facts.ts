import { createHash } from "node:crypto";
import { z } from "zod";
import type { RemovalSubmissionContext } from "./certify-context-types";
import { TRANSPORT_EVIDENCE_LEDGER_KIND } from "@/lib/certification/evidence-ledger/types";
import { DURABILITY_EVIDENCE_LEDGER_KIND } from "@/lib/certification/evidence-ledger/durability-types";
import { isUsableNumber, isUsableRatio } from "@/lib/calculations/biochar-eligibility";
import { clampFactor } from "@/lib/isometric/utils/aggregation";
import { samplingDayOf } from "@/lib/certification/evidence-ledger/durability-build-model";
import { samplingDay } from "@/lib/certification/evidence-ledger/durability-1000-build-model";
import { orderedDurabilityBatches, orderedLegs } from "./evidence-ledger-models";

// A format discriminator, not a formula/mapping revision. Model-hash baselines
// cannot be compared to input hashes and must remain unknown.
export const generatedEvidenceFactsSchema = z.object({
  format: z.literal("ledger-inputs-v1"),
  transport: z.string().nullable(),
  durability: z.string().nullable(),
});
export type GeneratedEvidenceFacts = z.infer<typeof generatedEvidenceFactsSchema>;

const numberOrNull = (value: number | null | undefined) => isUsableNumber(value) ? value : null;
const ratioOrNull = (value: number | null | undefined) => isUsableRatio(value) ? value : null;
const fingerprint = (inputs: unknown) => createHash("sha256").update(JSON.stringify(inputs)).digest("hex");

function durabilityInputs(ctx: RemovalSubmissionContext) {
  const tier = ctx.batchesWithSamples[0]?.durabilityOption;
  if (!tier || !ctx.batchesWithSamples.every(batch => batch.durabilityOption === tier)
    || (tier === "200_year" && !ctx.facilityReferenceSoilTemperature)) return null;

  const batches = orderedDurabilityBatches(ctx).flatMap(batch => {
    const samples = tier === "1000_year"
      ? batch.samples.filter(s => isUsableNumber(s.totalCarbonPercent)
        && isUsableNumber(s.inorganicCarbonPercent) && isUsableNumber(s.sReflectanceFraction))
        .map(s => ({
          samplingDay: samplingDay(s.samplingTime, batch.facilityTimezone),
          totalCarbonPercent: s.totalCarbonPercent,
          inorganicCarbonPercent: s.inorganicCarbonPercent,
          sReflectanceFraction: s.sReflectanceFraction,
        }))
      : batch.samples.map(s => {
        const rendered = isUsableRatio(s.hToCOrgRatio);
        const total = numberOrNull(s.totalCarbonPercent);
        const inorganic = numberOrNull(s.inorganicCarbonPercent);
        // Organic carbon is read for every rendered replicate, and otherwise
        // only for the inorganic-carbon fallback. Store operands, not Eq.2.
        const organic = rendered || (inorganic === null && total !== null)
          ? numberOrNull(s.organicCarbonPercent) : null;
        return {
          hToCOrgRatio: ratioOrNull(s.hToCOrgRatio),
          oToCOrgRatio: ratioOrNull(s.oToCOrgRatio),
          totalCarbonPercent: total,
          inorganicCarbonPercent: inorganic,
          organicCarbonPercent: organic,
          ...(rendered ? { samplingDay: samplingDayOf(s.samplingTime, batch.facilityTimezone) } : {}),
        };
      });
    // The 200-year ledger omits unsampled batches; the 1000-year ledger
    // requires complete measured carbon/S inputs. Never call a formula here.
    if (tier === "200_year" ? !batch.samples.some(s => isUsableRatio(s.hToCOrgRatio)) : !samples.length) return [];
    return [{
      samples,
      runs: batch.runs.map(run => ({
        dryMassKg: run.biocharDryMassKg ?? 0,
        attribution: clampFactor(ctx.attributionByRunId?.get(run.id)),
      })),
    }];
  });
  if (!batches.length) return null;
  return {
    tier,
    batches,
    // Effective temperature, flooring flags and method text are derived.
    ...(tier === "200_year" ? { soil: {
      declaredSoilTemperatureC: ctx.facilityReferenceSoilTemperature!.declaredSoilTemperatureC,
      source: ctx.facilityReferenceSoilTemperature!.source,
    } } : {}),
  };
}

/** Fingerprint only the values read by the ledger, in generation row order.
 * IDs establish order/attribution but are not evidence values. Display labels,
 * derived outputs, formula constants and blueprint versions never enter hashes.
 */
export function generatedEvidenceFacts(ctx: RemovalSubmissionContext): GeneratedEvidenceFacts {
  const empty: GeneratedEvidenceFacts = { format: "ledger-inputs-v1", transport: null, durability: null };
  if (!ctx.mapping || !ctx.memberBatches.length) return empty;
  const categories = [
    orderedLegs(ctx.transportLegs.feedstock),
    [...ctx.transportLegs.biochar].sort((a, b) => a.id.localeCompare(b.id)),
    orderedLegs(ctx.transportLegs.sample),
  ].map(legs => legs.map(leg => ({
    distanceKm: leg.distanceKm,
    loadMassKg: leg.loadMassKg != null && leg.loadMassKg > 0 ? leg.loadMassKg : 0,
    transportMethodType: leg.transportMethodType.length
      ? leg.transportMethodType[0].toUpperCase() + leg.transportMethodType.slice(1) : "",
  })));
  const durability = durabilityInputs(ctx);
  return {
    ...empty,
    transport: categories.some(legs => legs.length) ? fingerprint(categories) : null,
    durability: durability ? fingerprint(durability) : null,
  };
}

/** Missing, legacy and model-fingerprint baselines are unknown, never changed. */
export function compareGeneratedEvidenceFacts(current: GeneratedEvidenceFacts, baseline: unknown) {
  const parsed = generatedEvidenceFactsSchema.safeParse(baseline);
  if (!parsed.success) return { status: "unknown" as const, changed: [] };
  const changed = ([
    ["transport", TRANSPORT_EVIDENCE_LEDGER_KIND], ["durability", DURABILITY_EVIDENCE_LEDGER_KIND],
  ] as const).flatMap(([key, kind]) => current[key] === parsed.data[key] ? [] : [{ kind }]);
  return { status: changed.length ? "changed" as const : "unchanged" as const, changed };
}
