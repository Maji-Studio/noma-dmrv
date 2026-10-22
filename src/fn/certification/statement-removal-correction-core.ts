import type { OrgContext } from "@/lib/auth/server";
import { listStatementRemovalIdentities } from "@/data-access/removal-entry-correction";
import { SafeError } from "@/lib/errors";
import { loadRemovalEntryCorrection } from "./removal-correction-core";

/** Must run inside withGhgVerifierSubmissionLock. Lineage/evidence writers share
 * that artifact fence, so the checked facts remain stable through provider I/O.
 */
export async function assertStatementRemovalsCurrent(ctx: OrgContext, statementId: string): Promise<void> {
  const removals = await listStatementRemovalIdentities(ctx, statementId);
  const changed: string[] = [];
  // Bound DB fan-out: each compilation already parallelizes its independent reads.
  for (const removal of removals) {
    if ((await loadRemovalEntryCorrection(ctx, removal.id)).correctionNeeded) changed.push(removal.code);
  }
  if (changed.length) throw new SafeError(changed.length === 1
    ? `Resubmit Removal ${changed[0]} first. Its records changed since it was sent.`
    : `Resubmit Removals ${changed.sort().join(", ")} first. Their records changed since they were sent.`);
}
