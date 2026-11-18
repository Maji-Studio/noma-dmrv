import { effectiveContract } from "@/lib/isometric/template-observations/line-sources";
import { effectiveFilePolicy, recordsNeedFile } from "@/lib/isometric/template-observations/file-policies";
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
  const automatic = await loadBatchesEmissionAutomaticFacts(ctx, ids, {}, tx);
  for (const batch of batches) {
    const observation = batch.removalTemplateId
      ? await getLatestTemplateObservation(ctx, "isometric", batch.removalTemplateId, tx) : null;
    if (!observation) continue;
    for (const group of observation.definition.groups) for (const component of group.components) {
      const stored = observation.lineSources[component.id];
      if (!stored) continue;
      const contract = effectiveContract(stored);
      const source = contract.automaticSource;
      if (source && recordsNeedFile(effectiveFilePolicy(contract), automatic[batch.id].automaticFigures[source]?.magnitude ?? "0") &&
        !files.some(file => file.anchor.creditBatchId === batch.id && file.anchor.componentId === component.id && file.document))
        throw new DomainError("conflict", EMISSION_ENTRIES_CHANGED, { retryable: true });
    }
    const evidence = deriveLineFileEvidence({ [batch.id]: {
      ...automatic[batch.id], entries: [], previousObservations: new Map(),
      lineFiles: groupEmissionLineFiles(files.filter(file => file.anchor.creditBatchId === batch.id)),
    } }, observation);
    for (const file of evidence) current.set(file.anchorId, file.anchorVersion);
  }
  if (current.size !== reviewed.length || reviewed.some(file => current.get(file.anchorId) !== file.version))
    throw new DomainError("conflict", EMISSION_ENTRIES_CHANGED, { retryable: true });
}
