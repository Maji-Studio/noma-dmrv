import { createHash } from "node:crypto";
import { z } from "zod";
import type { RemovalSubmissionContext } from "./certify-context-types";
import { TRANSPORT_EVIDENCE_LEDGER_KIND } from "@/lib/certification/evidence-ledger/types";
import { DURABILITY_EVIDENCE_LEDGER_KIND } from "@/lib/certification/evidence-ledger/durability-types";
import { attributedProductMassKg } from "@/lib/isometric/utils/durability-aggregation";
import { orderedTransportLedgerLegs, selectThousandYearLedgerSamples, selectTwoHundredYearLedgerSamples, transportLedgerInput } from "@/lib/certification/evidence-ledger/input-selection";
import { orderedDurabilityBatches } from "./evidence-ledger-models";

// A format discriminator, not a formula/mapping revision. Model-hash baselines
// cannot be compared to input hashes and must remain unknown.
export const generatedEvidenceFactsSchema = z.object({
  format: z.literal("ledger-inputs-v2"),
  transport: z.string().nullable(),
  durability: z.string().nullable(),
});
export type GeneratedEvidenceFacts = z.infer<typeof generatedEvidenceFactsSchema>;

const fingerprint = (inputs: unknown) => createHash("sha256").update(JSON.stringify(inputs)).digest("hex");

function durabilityInputs(ctx: RemovalSubmissionContext) {
  const tier = ctx.batchesWithSamples[0]?.durabilityOption;
  if (!tier || !ctx.batchesWithSamples.every(batch => batch.durabilityOption === tier)
    || (tier === "200_year" && !ctx.facilityReferenceSoilTemperature)) return null;

  const batches = orderedDurabilityBatches(ctx).flatMap(batch => {
    const selected = tier === "1000_year"
      ? selectThousandYearLedgerSamples(batch.samples, batch.facilityTimezone)
      : selectTwoHundredYearLedgerSamples(batch.samples, batch.facilityTimezone).samples;
    if (!selected.length) return [];
    const samples = selected.map(row => row.input);
    return [{
      samples,
      productMassKg: attributedProductMassKg(batch.runs, ctx.attributionByRunId),
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
  const empty: GeneratedEvidenceFacts = { format: "ledger-inputs-v2", transport: null, durability: null };
  if (!ctx.mapping || !ctx.memberBatches.length) return empty;
  const legs = orderedTransportLedgerLegs(ctx.transportLegs);
  const categories = [legs.feedstock, legs.biochar, legs.sample].map(category => category.map(transportLedgerInput));
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
