import type { TransportLeg } from "@/db/schema";
import { z } from "zod";
import type { RemovalSubmissionContext } from "./certify-context-types";
import { TRANSPORT_EVIDENCE_LEDGER_KIND } from "@/lib/certification/evidence-ledger/types";
import { DURABILITY_EVIDENCE_LEDGER_KIND } from "@/lib/certification/evidence-ledger/durability-types";
import { transportLedgerModel, durabilityLedgerModel, stableLedgerContentHash } from "./evidence-ledger-models";

export const generatedEvidenceFactsSchema = z.object({
  transport: z.string().nullable(),
  durability: z.string().nullable(),
});
export type GeneratedEvidenceFacts = z.infer<typeof generatedEvidenceFactsSchema>;

/** Use the ledger's exact row order and tier-specific reads, with display labels neutralized.
 * Hashing the model also preserves its numeric normalization: an unused source edit
 * cannot demand a resubmission that would reuse the same ledger.
 */
export function generatedEvidenceFacts(ctx: RemovalSubmissionContext): GeneratedEvidenceFacts {
  if (!ctx.mapping || !ctx.memberBatches.length) return { transport: null, durability: null };
  const neutral: RemovalSubmissionContext = {
    ...ctx,
    mapping: { ...ctx.mapping, externalProjectId: "" },
    memberBatches: ctx.memberBatches.map(batch => ({ ...batch, code: "" })),
    transportLegs: Object.fromEntries(Object.entries(ctx.transportLegs).map(([category, legs]) => [category,
      legs.map((leg: TransportLeg) => ({ ...leg, originName: "", destinationName: "", originGpsLatitude: null,
        originGpsLongitude: null, destinationGpsLatitude: null, destinationGpsLongitude: null,
        vehicleType: null, modelYear: null, isDerived: false, distanceSource: "manual" as const })),
    ])) as RemovalSubmissionContext["transportLegs"],
    batchesWithSamples: ctx.batchesWithSamples.map(batch => ({ ...batch, creditBatchCode: "",
      samples: batch.samples.map(sample => ({ ...sample, sampleCode: "", labName: null })),
    })),
  };
  const transport = transportLedgerModel(neutral, null, "");
  const tier = neutral.batchesWithSamples[0]?.durabilityOption;
  const hasDurability = tier && neutral.batchesWithSamples.every(batch => batch.durabilityOption === tier)
    && (tier !== "200_year" || !!neutral.facilityReferenceSoilTemperature);
  const durability = hasDurability ? durabilityLedgerModel(neutral, null, "").model : null;
  return {
    transport: transport.totalLegs ? stableLedgerContentHash(transport) : null,
    durability: durability?.batches.length ? stableLedgerContentHash(durability) : null,
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
