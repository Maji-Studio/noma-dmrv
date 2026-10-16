import { withDedicatedLockConnection } from "@/db";
import type { OrgContext } from "@/lib/auth/server";
import { acquireCertificationArtifactLocksSorted } from "@/lib/certification/submission-lock";
import { requireOrgScope } from "./utils";

/** Facility durability is held first. Source writers take this same artifact lock.
 * Keep it through provider I/O and committed finalization, without holding rows
 * or a shared-pool connection needed by finalization.
 */
export async function withGhgVerifierSubmissionLock<T>(ctx: OrgContext, statementId: string, submit: () => Promise<T>): Promise<T> {
  requireOrgScope(ctx);
  return withDedicatedLockConnection(async tx => {
    await acquireCertificationArtifactLocksSorted(tx, [{ provider: "isometric", localEntityType: "ghgStatement", localEntityId: statementId }]);
    return submit();
  });
}
