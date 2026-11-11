import type { DbTransaction } from "@/db";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";
import { EMISSION_ENTRIES_CHANGED } from "@/lib/certification/emission-entry-messages";
import { deriveLineFileEvidence } from "@/lib/certification/emission-line-file-evidence";
import { groupEmissionLineFiles } from "@/lib/certification/emission-line-file-facts";
import { loadBatchesEmissionAutomaticFacts } from "./batch-emission-automatic-figures";
import { listEmissionLineFilesForBatches } from "./emission-line-files";
import { getLatestTemplateObservation } from "./removal-template-observations";
import { requireOrgScope } from "./utils";

/** The caller holds every production batch lock, also held by file writers. */
export async function assertComponentFileClaimFresh(ctx: OrgContext, tx: DbTransaction,
  batches: readonly { id: string; removalTemplateId: string | null }[],
  reviewed: readonly { anchorId: string; version: number }[],
) {
  requireOrgScope(ctx);
  const ids = batches.map(batch => batch.id);
  const files = await listEmissionLineFilesForBatches(ctx, ids, tx);
  const current = new Map<string, number>();
  // Empty anchors and pending uploads are not part of the payload.
  if (files.some(file => file.document)) {
    const automatic = await loadBatchesEmissionAutomaticFacts(ctx, ids, {}, tx);
    for (const batch of batches) {
      const observation = batch.removalTemplateId
        ? await getLatestTemplateObservation(ctx, "isometric", batch.removalTemplateId, tx) : null;
      if (!observation) continue;
      const evidence = deriveLineFileEvidence({ [batch.id]: {
        ...automatic[batch.id], entries: [], previousObservations: new Map(),
        lineFiles: groupEmissionLineFiles(files.filter(file => file.anchor.creditBatchId === batch.id)),
      } }, observation);
      for (const file of evidence) current.set(file.anchorId, file.anchorVersion);
    }
  }
  if (current.size !== reviewed.length || reviewed.some(file => current.get(file.anchorId) !== file.version))
    throw new DomainError("conflict", EMISSION_ENTRIES_CHANGED, { retryable: true });
}
