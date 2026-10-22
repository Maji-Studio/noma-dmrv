import { z } from "zod";
import type { OrgContext } from "@/lib/auth/server";
import { getSentRemovalForComparison, listStatementRemovalExternalIds, listStatementRemovalIdentities } from "@/data-access/removal-entry-correction";
import { getCreditBatchesByRemovalId } from "@/data-access/certifier-removals";
import { getLatestTemplateObservation, getTemplateObservationById } from "@/data-access/removal-template-observations";
import { SafeError } from "@/lib/errors";
import { entryInputManifestSchema } from "@/lib/certification/removal-emission-contributions";
import { deriveRemovalSemanticCorrection } from "@/lib/certification/removal-semantic-correction";
import { compileRemovalCorrectionContent } from "./removal-correction-core";

const sentSchema = z.object({ templateObservationId: z.string(), semantic: z.record(z.string(), z.unknown()) });
const entriesSchema = z.array(entryInputManifestSchema);

/** Must run inside withGhgVerifierSubmissionLock. Lineage/evidence writers share
 * that artifact fence, so the checked facts remain stable through provider I/O.
 * Eligibility for editing is deliberately not an input to this comparison.
 */
export async function assertStatementRemovalsCurrent(ctx: OrgContext, statementId: string, remoteEntryIds?: readonly string[]): Promise<void> {
  if (remoteEntryIds) {
    const known = new Set((await listStatementRemovalExternalIds(ctx, statementId)).map(row => row.externalId));
    if (remoteEntryIds.some(id => !known.has(id))) throw new SafeError(
      "This GHG Statement has Removals noma does not know about. Sync it, then try again.");
  }
  const removals = await listStatementRemovalIdentities(ctx, statementId);
  const changed: string[] = [];
  // Bound DB fan-out: each compilation already parallelizes its independent reads.
  for (const removal of removals) {
    let needsResubmit: boolean;
    try {
      const sent = await getSentRemovalForComparison(ctx, removal.id);
      const snapshot = sentSchema.parse(sent?.payloadSnapshot);
      if (!await getTemplateObservationById(ctx, snapshot.templateObservationId)) throw new Error("Missing sent observation");
      const batches = await getCreditBatchesByRemovalId(ctx, removal.id);
      const pin = batches[0]?.removalTemplateId;
      const observation = pin ? await getLatestTemplateObservation(ctx, "isometric", pin) : null;
      if (!observation) throw new Error("Missing current observation");
      const current = await compileRemovalCorrectionContent(ctx, removal.id, observation, true);
      if (!current) throw new Error("Content could not be compiled");
      needsResubmit = deriveRemovalSemanticCorrection({ windowOpen: true, previous: snapshot.semantic, current,
        previousEntries: entriesSchema.parse(snapshot.semantic.entryContributions ?? []),
        currentEntries: entriesSchema.parse(current.entryContributions ?? []),
        componentIds: observation.definition.groups.flatMap(group => group.components.map(component => component.id)),
        batchIds: batches.map(batch => batch.id),
      }).correctionNeeded;
    } catch {
      throw new SafeError(`Check Removal ${removal.code} again before resubmitting the GHG Statement.`);
    }
    if (needsResubmit) changed.push(removal.code);
  }
  if (changed.length) throw new SafeError(changed.length === 1
    ? `Resubmit Removal ${changed[0]} first. Its records changed since it was sent.`
    : `Resubmit Removals ${changed.sort().join(", ")} first. Their records changed since they were sent.`);
}
