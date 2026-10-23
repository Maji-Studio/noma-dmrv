import type { OrgContext } from "@/lib/auth/server";
import { getSentRemovalForComparison } from "@/data-access/removal-entry-correction";
import { generatedEvidenceFacts, generatedEvidenceFactsSchema, compareGeneratedEvidenceFacts } from "./generated-evidence-facts";
import { TRANSPORT_EVIDENCE_LEDGER_KIND } from "@/lib/certification/evidence-ledger/types";
import { DURABILITY_EVIDENCE_LEDGER_KIND } from "@/lib/certification/evidence-ledger/durability-types";
import type { RemovalSubmissionContext } from "./certify-context-types";
import { transportLedgerModel, durabilityLedgerModel, stableLedgerContentHash } from "./evidence-ledger-models";

/** Mirror generation/retirement decisions, without rendering, storage or writes. */
export function currentEvidenceLedgerHashes(ctx: RemovalSubmissionContext, facilityName: string | null) {
  if (!ctx.mapping || !ctx.memberBatches.length) return [];
  const transport = transportLedgerModel(ctx, facilityName, "");
  const tier = ctx.batchesWithSamples[0]?.durabilityOption;
  const hasDurability = tier && ctx.batchesWithSamples.every(batch => batch.durabilityOption === tier)
    && (tier !== "200_year" || !!ctx.facilityReferenceSoilTemperature);
  const durability = hasDurability ? durabilityLedgerModel(ctx, facilityName, "") : null;
  return [
    { kind: TRANSPORT_EVIDENCE_LEDGER_KIND, hash: transport.totalLegs ? stableLedgerContentHash(transport) : null },
    { kind: DURABILITY_EVIDENCE_LEDGER_KIND, hash: durability?.batches.length ? stableLedgerContentHash({ ...durability, durabilityOption: tier }) : null },
  ];
}

/** Only the immutable sent snapshot is authoritative; active documents may be newer. */
export async function changedGeneratedEvidence(ctx: OrgContext, removalId: string, context: RemovalSubmissionContext) {
  const sent = await getSentRemovalForComparison(ctx, removalId);
  const snapshot = sent?.payloadSnapshot;
  const baseline = snapshot && typeof snapshot === "object" && "generatedEvidenceFacts" in snapshot
    ? snapshot.generatedEvidenceFacts : undefined;
  if (!generatedEvidenceFactsSchema.safeParse(baseline).success) return [];
  return compareGeneratedEvidenceFacts(generatedEvidenceFacts(context), baseline).changed;
}
