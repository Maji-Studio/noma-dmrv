import type { OrgContext } from "@/lib/auth/server";
import { listDocumentsByKindForRemoval } from "@/data-access/documents";
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

/** The persisted document hash is the same hash used for submit-time reuse. */
export async function changedGeneratedEvidence(ctx: OrgContext, removalId: string, context: RemovalSubmissionContext, facilityName: string | null) {
  const hashes = currentEvidenceLedgerHashes(context, facilityName);
  const changed = await Promise.all(hashes.map(async ({ kind, hash }) => {
    const documents = await listDocumentsByKindForRemoval(ctx, kind, removalId);
    const metadata = documents[0]?.metadata;
    const storedHash = metadata && typeof metadata === "object" && "contentHash" in metadata ? metadata.contentHash : null;
    const matches = hash === null ? documents.length === 0 : documents.length === 1 && storedHash === hash;
    return matches ? [] : [{ kind, hash }];
  }));
  return changed.flat();
}
