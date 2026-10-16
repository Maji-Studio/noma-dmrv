import type { OrgContext } from "@/lib/auth/server";
import { emissionsEntriesEnabled } from "@/lib/certification/emissions-entry-gate";
import { loadBatchEmissionEntryFacts } from "@/data-access/emission-entry-facts";
import { loadBatchAutomaticFigures } from "@/data-access/batch-emission-automatic-figures";
import type { BatchEmissionLineFacts } from "@/lib/certification/emission-lines";
import type { FacilityCertifierFacts } from "./facility-certifier-facts";

export type BatchEmissionContext = Record<string, Pick<BatchEmissionLineFacts, "entries" | "automaticFigures">>;

/** Batch-wide facts, even when the Removal carries only some applications. */
export async function loadBatchEmissionContext(
  ctx: OrgContext, facilityId: string,
  batches: readonly { id: string; removalTemplateId: string | null }[],
  facilityFacts: FacilityCertifierFacts,
): Promise<BatchEmissionContext> {
  const result: BatchEmissionContext = {};
  if (!emissionsEntriesEnabled()) return result;
  for (const batch of batches) {
    const observation = batch.removalTemplateId
      ? facilityFacts.templatesById[batch.removalTemplateId]?.observation : null;
    if (!observation) continue;
    const { entries } = await loadBatchEmissionEntryFacts(ctx, batch.id, observation);
    const automaticFigures = await loadBatchAutomaticFigures(ctx, facilityId, batch.id);
    result[batch.id] = { entries, automaticFigures };
  }
  return result;
}
