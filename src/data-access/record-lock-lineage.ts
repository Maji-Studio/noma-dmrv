import { and, eq, inArray } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { certificationSubmissions } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { getMetadataValue } from "@/lib/certification/submission-metadata";
import { getGhgStatement } from "@/lib/isometric/ghg-statements";
import { isLockedInFlight } from "@/lib/isometric/utils/lock";
import { REMOVAL_SCOPED_SUBMISSION_TYPES } from "@/lib/isometric/utils/constants";
import { isSentRemoval, type RecordLockRemoval, type RecordLockStatement } from "@/lib/record-lock";
import { resolveIsometricClient } from "./certifier-credentials";
import { requireOrgScope } from "./utils";

type Removal = { removalId: string; ghgStatementId: string | null };
type Submission = typeof certificationSubmissions.$inferSelect;

/** Include historical statement membership, not just the Removal's current FK. */
export async function readRecordLockLineage(ctx: OrgContext, tx: DbTransaction, removals: readonly Removal[], fresh = false): Promise<RecordLockRemoval[]> {
  requireOrgScope(ctx);
  const ids = [...new Set(removals.map(row => row.removalId))];
  if (!ids.length) return [];
  const removalRows = await tx.select().from(certificationSubmissions).where(and(
    eq(certificationSubmissions.organizationId, ctx.organizationId),
    eq(certificationSubmissions.provider, "isometric"),
    eq(certificationSubmissions.localEntityType, "removal"),
    inArray(certificationSubmissions.localEntityId, ids),
    inArray(certificationSubmissions.submissionType, REMOVAL_SCOPED_SUBMISSION_TYPES),
  ));
  const statementRows = await tx.select().from(certificationSubmissions).where(and(
    eq(certificationSubmissions.organizationId, ctx.organizationId),
    eq(certificationSubmissions.provider, "isometric"),
    eq(certificationSubmissions.localEntityType, "ghgStatement"),
    eq(certificationSubmissions.submissionType, "ghg_statement"),
  ));
  const statementFacts = new Map<string, Promise<RecordLockStatement>>();
  return Promise.all(ids.map(async id => {
    const submissions = removalRows.filter(row => row.localEntityId === id);
    const externalIds = new Set(submissions.map(row => row.externalId).filter(Boolean));
    const currentIds = new Set(removals.filter(row => row.removalId === id).map(row => row.ghgStatementId));
    const covering = statementRows.filter(row => {
      const hasRegistryStatus = getMetadataValue(row.metadata, "remoteStatus") !== null;
      if (!hasRegistryStatus && !isSentRemoval({ id: row.localEntityId, submissions: [submissionFact(row)], statements: [] })) return false;
      const members = getMetadataValue(row.metadata, "removalIds");
      return currentIds.has(row.localEntityId) || (Array.isArray(members) && members.some(member => externalIds.has(member)));
    });
    return { id, submissions: submissions.map(submissionFact),
      statements: await Promise.all(covering.map(row => {
        if (!statementFacts.has(row.id)) statementFacts.set(row.id, readStatement(ctx, tx, row, fresh));
        return statementFacts.get(row.id)!;
      })) };
  }));
}

async function readStatement(ctx: OrgContext, tx: DbTransaction, row: Submission, fresh: boolean): Promise<RecordLockStatement> {
  const savedStatus = getMetadataValue(row.metadata, "remoteStatus");
  const savedSubmitted = getMetadataValue(row.metadata, "submittedToVerifierAt");
  const fact: RecordLockStatement = { id: row.localEntityId,
    status: typeof savedStatus === "string" ? savedStatus : null,
    fresh: false, submittedToVerifier: typeof savedSubmitted === "string" && Number.isFinite(Date.parse(savedSubmitted)),
    inFlight: isLockedInFlight(row) || !["submitted", "accepted", "rejected", "superseded"].includes(row.status),
  };
  if (!fresh || !row.externalId || fact.inFlight) return fact;
  try {
    const remote = await getGhgStatement(await resolveIsometricClient(ctx, tx), row.externalId);
    return { ...fact, status: remote.status, fresh: true,
      submittedToVerifier: fact.submittedToVerifier || Boolean(remote.submitted_at && Number.isFinite(Date.parse(remote.submitted_at))) };
  } catch {
    // A failed registry read cannot authorize an edit of previously sent data.
    return fact;
  }
}

function submissionFact(row: Submission) {
  return { status: row.status, inFlight: isLockedInFlight(row),
    hasRemoteMutation: Boolean(row.externalId) || ["possible", "confirmed"].includes(String(getMetadataValue(row.metadata, "externalMutation"))) };
}
