import type { OrgContext } from "@/lib/auth/server";
import { listNomaSentRemovalsForRemoteEntries, listStatementRemovalIdentities } from "@/data-access/removal-entry-correction";
import { logger } from "@/lib/log";
import { SafeError } from "@/lib/errors";
import { compareRemovalCurrentContent } from "./removal-content-comparison-core";

/** Must run inside withGhgVerifierSubmissionLock. Lineage/evidence writers share
 * that artifact fence, so the checked facts remain stable through provider I/O.
 * Eligibility for editing is deliberately not an input to this comparison.
 */
export async function assertStatementRemovalsCurrent(ctx: OrgContext, statementId: string, remoteEntryIds?: readonly string[], compareMembers = true): Promise<void> {
  if (remoteEntryIds) {
    const mapped = await listNomaSentRemovalsForRemoteEntries(ctx, statementId, remoteEntryIds);
    const missing = mapped.filter(row => row.ghgStatementId !== statementId);
    if (missing.length) {
      const codes = missing.map(row => row.code).sort().join(", ");
      const subject = missing.length === 1 ? `Removal ${codes} is` : `Removals ${codes} are`;
      throw new SafeError(`${subject} in this GHG Statement at Isometric but not in noma yet. Use Sync from registry on the GHG Statements page, then try again.`);
    }
  }
  if (!compareMembers) return;
  const removals = await listStatementRemovalIdentities(ctx, statementId);
  const changed: string[] = [];
  const unavailable: string[] = [];
  // Bound DB fan-out: each compilation already parallelizes its independent reads.
  for (const removal of removals) {
    let comparison;
    try {
      comparison = await compareRemovalCurrentContent(ctx, removal.id);
    } catch (error) {
      // Never serialize error messages or bodies: they can contain operator data.
      logger.warn({ removalId: removal.id, statementId, reason: "unexpected_error" }, "GHG Statement member comparison failed");
      throw error;
    }
    if (comparison.kind === "unavailable") {
      logger.warn({ removalId: removal.id, statementId, reason: comparison.reason }, "GHG Statement member comparison failed");
      unavailable.push(removal.code);
    } else if (comparison.kind === "changed") changed.push(removal.code);
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
