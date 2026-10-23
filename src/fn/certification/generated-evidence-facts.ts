import { z } from "zod";
import type { RemovalSubmissionContext } from "./certify-context-types";
import { TRANSPORT_EVIDENCE_LEDGER_KIND } from "@/lib/certification/evidence-ledger/types";
import { DURABILITY_EVIDENCE_LEDGER_KIND } from "@/lib/certification/evidence-ledger/durability-types";

const measured = z.number().nullable();
export const generatedEvidenceFactsSchema = z.object({
  transport: z.array(z.object({
    category: z.string(), id: z.string(), entityType: z.string(), entityId: z.string(),
    distanceKm: z.number(), loadMassKg: measured, method: z.string(), calculationMethod: z.string(),
    roundTrip: z.boolean(),
  })),
  durability: z.object({
    memberBatchIds: z.array(z.string()),
    declaredSoilTemperatureC: measured,
    batches: z.array(z.object({
      creditBatchId: z.string(), durabilityOption: z.string(),
      samples: z.array(z.object({ id: z.string(), hToCOrgRatio: measured, oToCOrgRatio: measured,
        totalCarbonPercent: measured, organicCarbonPercent: measured, inorganicCarbonPercent: measured,
        sReflectanceFraction: measured, randomReflectanceR0Percent: measured })),
      runs: z.array(z.object({ id: z.string(), biocharDryMassKg: measured, attribution: z.number() })),
    })),
  }),
});
export type GeneratedEvidenceFacts = z.infer<typeof generatedEvidenceFactsSchema>;

/** Source values only. No rendered labels, blueprint versions or formula outputs. */
export function generatedEvidenceFacts(ctx: RemovalSubmissionContext): GeneratedEvidenceFacts {
  return {
    transport: Object.entries(ctx.transportLegs).sort(([a], [b]) => a.localeCompare(b)).flatMap(([category, legs]) =>
      [...legs].sort((a, b) => a.id.localeCompare(b.id)).map(leg => ({
        category, id: leg.id, entityType: leg.entityType, entityId: leg.entityId,
        distanceKm: leg.distanceKm, loadMassKg: leg.loadMassKg ?? null,
        method: leg.transportMethodType, calculationMethod: leg.calculationMethodType,
        // All transport legs currently count a round trip; there is no per-row flag.
        roundTrip: true,
      }))),
    durability: {
      memberBatchIds: ctx.memberBatches.map(batch => batch.id).sort(),
      declaredSoilTemperatureC: ctx.facilityReferenceSoilTemperature?.declaredSoilTemperatureC ?? null,
      batches: [...ctx.batchesWithSamples].sort((a, b) => a.creditBatchId.localeCompare(b.creditBatchId)).map(batch => ({
        creditBatchId: batch.creditBatchId, durabilityOption: batch.durabilityOption,
        samples: [...batch.samples].sort((a, b) => a.id.localeCompare(b.id)).map(sample => ({
          id: sample.id, hToCOrgRatio: sample.hToCOrgRatio, oToCOrgRatio: sample.oToCOrgRatio,
          totalCarbonPercent: sample.totalCarbonPercent, organicCarbonPercent: sample.organicCarbonPercent,
          inorganicCarbonPercent: sample.inorganicCarbonPercent, sReflectanceFraction: sample.sReflectanceFraction,
          randomReflectanceR0Percent: sample.randomReflectanceR0Percent,
        })),
        runs: [...batch.runs].sort((a, b) => a.id.localeCompare(b.id)).map(run => ({
          id: run.id, biocharDryMassKg: run.biocharDryMassKg,
          attribution: ctx.attributionByRunId.get(run.id) ?? 1,
        })),
      })),
    },
  };
}

/** Missing historical raw facts are unknown, never evidence of a change. */
export function compareGeneratedEvidenceFacts(current: GeneratedEvidenceFacts, baseline: unknown) {
  const parsed = generatedEvidenceFactsSchema.safeParse(baseline);
  if (!parsed.success) return { status: "unknown" as const, changed: [] };
  const changed = ([
    ["transport", TRANSPORT_EVIDENCE_LEDGER_KIND], ["durability", DURABILITY_EVIDENCE_LEDGER_KIND],
  ] as const).flatMap(([key, kind]) => JSON.stringify(current[key]) === JSON.stringify(parsed.data[key]) ? [] : [{ kind }]);
  return { status: changed.length ? "changed" as const : "unchanged" as const, changed };
}
