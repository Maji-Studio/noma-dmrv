import { and, eq, sql } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { certificationSubmissions } from "@/db/schema/certification";
import type { OrgContext } from "@/lib/auth/server";
import { SUBMISSION_METADATA_KEYS } from "@/lib/certification/submission-metadata";
import { requireOrgScope } from "./utils";

/**
 * The one statement that rejects a draft submission. It releases the lock,
 * records the error, and clears the last attempt outcome and external-mutation
 * marker, because a definitive rejection leaves no registry write in doubt.
 *
 * Status-guarded to drafts and, when given, to the caller's own lock. Callers
 * decide whether rejection is safe; `retireStaleSubmissionDraft` deliberately
 * keeps the external-mutation marker and does not use this.
 */
export async function rejectDraftSubmission(
  ctx: OrgContext,
  executor: Pick<DbTransaction, "update">,
  id: string,
  args: { errorMessage: string; expectedLockedAt?: Date },
): Promise<void> {
  requireOrgScope(ctx);
  await executor
    .update(certificationSubmissions)
    .set({
      status: "rejected",
      lockedAt: null,
      updatedAt: sql`now()`,
      metadata: sql`(coalesce(${certificationSubmissions.metadata}, '{}'::jsonb) - ${SUBMISSION_METADATA_KEYS.lastAttemptOutcome}::text - ${SUBMISSION_METADATA_KEYS.externalMutation}::text) || jsonb_build_object(${SUBMISSION_METADATA_KEYS.lastError}::text, ${args.errorMessage}::text)`,
    })
    .where(
      and(
        eq(certificationSubmissions.id, id),
        eq(certificationSubmissions.status, "draft"),
        args.expectedLockedAt
          ? eq(certificationSubmissions.lockedAt, args.expectedLockedAt)
          : undefined,
        eq(certificationSubmissions.organizationId, ctx.organizationId),
      ),
    );
}
