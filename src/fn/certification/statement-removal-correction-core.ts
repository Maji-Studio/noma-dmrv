import { z } from "zod";
import type { OrgContext } from "@/lib/auth/server";
import { getSentRemovalForComparison, listStatementRemovalExternalIds, listStatementRemovalIdentities } from "@/data-access/removal-entry-correction";
import { getCreditBatchesByRemovalId } from "@/data-access/certifier-removals";
import { getLatestTemplateObservation } from "@/data-access/removal-template-observations";
import { logger } from "@/lib/log";
import { SafeError } from "@/lib/errors";
import { entryInputManifestSchema } from "@/lib/certification/removal-emission-contributions";
import { deriveRemovalSemanticCorrection } from "@/lib/certification/removal-semantic-correction";
import { compileRemovalCorrectionContent } from "./removal-correction-core";

const sentSchema = z.object({ semantic: z.record(z.string(), z.unknown()) });
const entriesSchema = z.array(entryInputManifestSchema);

class ComparisonUnavailable extends Error {
  constructor(readonly reason: "missing_observation" | "invalid_compile") { super(reason); }
}

/** Must run inside withGhgVerifierSubmissionLock. Lineage/evidence writers share
 * that artifact fence, so the checked facts remain stable through provider I/O.
 * Eligibility for editing is deliberately not an input to this comparison.
 */
export async function assertStatementRemovalsCurrent(ctx: OrgContext, statementId: string, remoteEntryIds?: readonly string[], compareMembers = true): Promise<void> {
  if (remoteEntryIds) {
    const known = new Set((await listStatementRemovalExternalIds(ctx, statementId)).map(row => row.externalId));
    if (remoteEntryIds.some(id => !known.has(id))) throw new SafeError(
      "This GHG Statement has Removals noma does not know about. Use Sync from registry on the GHG Statements page, then try again.");
  }
  if (!compareMembers) return;
  const removals = await listStatementRemovalIdentities(ctx, statementId);
  const changed: string[] = [];
  const unavailable: string[] = [];
  // Bound DB fan-out: each compilation already parallelizes its independent reads.
  for (const removal of removals) {
    let needsResubmit: boolean;
    try {
      const sent = await getSentRemovalForComparison(ctx, removal.id);
      const snapshot = sentSchema.parse(sent?.payloadSnapshot);
      const batches = await getCreditBatchesByRemovalId(ctx, removal.id);
      const pin = batches[0]?.removalTemplateId;
      const observation = pin ? await getLatestTemplateObservation(ctx, "isometric", pin) : null;
      if (!observation) throw new ComparisonUnavailable("missing_observation");
      const current = await compileRemovalCorrectionContent(ctx, removal.id, observation, true);
      if (!current) throw new ComparisonUnavailable("invalid_compile");
      needsResubmit = deriveRemovalSemanticCorrection({ windowOpen: true, previous: snapshot.semantic, current,
        previousEntries: entriesSchema.parse(snapshot.semantic.entryContributions ?? []),
        currentEntries: entriesSchema.parse(current.entryContributions ?? []),
        componentIds: observation.definition.groups.flatMap(group => group.components.map(component => component.id)),
        batchIds: batches.map(batch => batch.id),
      }).correctionNeeded;
    } catch (error) {
      // Never serialize error messages or bodies: they can contain operator data.
      const reason = error instanceof ComparisonUnavailable ? error.reason
        : error instanceof z.ZodError ? "invalid_snapshot"
        : error instanceof SafeError ? "compile_refused" : "unexpected_error";
      logger.warn({ removalId: removal.id, statementId, reason }, "GHG Statement member comparison failed");
      if (reason === "unexpected_error") throw error;
      unavailable.push(removal.code);
      continue;
    }
    if (needsResubmit) changed.push(removal.code);
  }
  if (unavailable.length) {
    const codes = unavailable.sort().join(", ");
    const subject = unavailable.length === 1 ? `Removal ${codes}` : `Removals ${codes}`;
    throw new SafeError(`noma could not compare ${subject} with what it sent, so the GHG Statement was not sent. Open ${subject}, then try again.`);
  }
  if (changed.length) throw new SafeError(changed.length === 1
    ? `Resubmit Removal ${changed[0]} first. Its records changed since it was sent.`
    : `Resubmit Removals ${changed.sort().join(", ")} first. Their records changed since they were sent.`);
}
