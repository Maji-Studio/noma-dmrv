import { and, eq, inArray } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { certificationSubmissions, certifierGhgStatements, certifierRemovals } from "@/db/schema";
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
export async function readRecordLockLineage(ctx: OrgContext, tx: Pick<DbTransaction, "select">, removals: readonly Removal[], fresh = false): Promise<RecordLockRemoval[]> {
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
    inArray(certificationSubmissions.localEntityId, tx.select({ id: certifierGhgStatements.id }).from(certifierGhgStatements).where(and(
      eq(certifierGhgStatements.organizationId, ctx.organizationId),
      inArray(certifierGhgStatements.facilityId, tx.select({ facilityId: certifierRemovals.facilityId }).from(certifierRemovals).where(and(
        eq(certifierRemovals.organizationId, ctx.organizationId), inArray(certifierRemovals.id, ids),
      ))),
    ))),
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
    const canRefresh = fresh && !submissions.some(row => isLockedInFlight(row) || !["submitted", "accepted", "rejected", "superseded"].includes(row.status)) &&
      covering.every(row => {
        const status = getMetadataValue(row.metadata, "remoteStatus");
        const submitted = getMetadataValue(row.metadata, "submittedToVerifierAt");
        return !isLockedInFlight(row) && (status === "FAILED_VERIFICATION" ||
          (status === "DRAFT" && typeof submitted === "string" && Number.isFinite(Date.parse(submitted))));
      });
    return { id, submissions: submissions.map(submissionFact),
      statements: await Promise.all(covering.map(row => {
        const key = `${row.id}:${canRefresh}`;
        if (!statementFacts.has(key)) statementFacts.set(key, readStatement(ctx, tx, row, canRefresh));
        return statementFacts.get(key)!;
      })) };
  }));
}

async function readStatement(ctx: OrgContext, tx: Pick<DbTransaction, "select">, row: Submission, fresh: boolean): Promise<RecordLockStatement> {
  const savedStatus = getMetadataValue(row.metadata, "remoteStatus");
  const savedSubmitted = getMetadataValue(row.metadata, "submittedToVerifierAt");
  const fact: RecordLockStatement = { id: row.localEntityId,
    status: typeof savedStatus === "string" ? savedStatus : null,
    fresh: false, submittedToVerifier: typeof savedSubmitted === "string" && Number.isFinite(Date.parse(savedSubmitted)),
    removalExternalIds: Array.isArray(getMetadataValue(row.metadata, "removalIds")) ? getMetadataValue(row.metadata, "removalIds") as string[] : [],
    inFlight: isLockedInFlight(row) || !["submitted", "accepted", "rejected", "superseded"].includes(row.status),
  };
  if (!fresh || !row.externalId || fact.inFlight ||
    !(fact.status === "FAILED_VERIFICATION" || (fact.status === "DRAFT" && fact.submittedToVerifier))) return fact;
  try {
    const remote = await getGhgStatement(await resolveIsometricClient(ctx, tx), row.externalId);
    return { ...fact, status: remote.status, fresh: true,
      // REST has no return timestamp. A verifier submission is a conservative
      // lower bound for its subsequent return, never the time of this read.
      returnedAt: remote.submitted_at ?? (typeof savedSubmitted === "string" ? savedSubmitted : null),
      removalExternalIds: remote.ghg_entry_ids,
      submittedToVerifier: fact.submittedToVerifier || Boolean(remote.submitted_at && Number.isFinite(Date.parse(remote.submitted_at))) };
  } catch {
    // A failed registry read cannot authorize an edit of previously sent data.
    return fact;
  }
}

function submissionFact(row: Submission) {
  return { id: row.id, externalId: row.externalId, submittedAt: row.submittedAt?.toISOString(), createdAt: row.createdAt.toISOString(), status: row.status, inFlight: isLockedInFlight(row),
    hasRemoteMutation: Boolean(row.externalId) || ["possible", "confirmed"].includes(String(getMetadataValue(row.metadata, "externalMutation"))) };
}
