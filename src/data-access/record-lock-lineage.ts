import { and, eq, inArray } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { certificationSubmissions, certifierGhgStatements, certifierRemovals } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { getMetadataValue } from "@/lib/certification/submission-metadata";
import { getTransactionDeadline } from "@/lib/db/transaction-deadline";
import { getGhgStatement, type GhgStatement } from "@/lib/isometric/ghg-statements";
import { isLockedInFlight } from "@/lib/isometric/utils/lock";
import { REMOVAL_SCOPED_SUBMISSION_TYPES } from "@/lib/isometric/utils/constants";
import { isSentRemoval, isTerminalAttemptStatus, submissionHasRemoteEffect, type RecordLockRemoval, type RecordLockStatement } from "@/lib/record-lock";
import { requireOrgScope } from "./utils";

const STATEMENT_REFRESH_TIMEOUT_MS = 1_000;
const TRANSACTION_FINISH_RESERVE_MS = 100;
type StatementReads = Map<string, Promise<GhgStatement>>;
// Transaction objects are short lived. Never retain fresh facts on the shared DB reader.
const transactionStatementReads = new WeakMap<object, StatementReads>();

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
  const labels = await tx.select({ id: certifierRemovals.id, startedOn: certifierRemovals.startedOn, completedOn: certifierRemovals.completedOn })
    .from(certifierRemovals).where(and(eq(certifierRemovals.organizationId, ctx.organizationId), inArray(certifierRemovals.id, ids)));
  const labelsById = new Map(labels.map(row => [row.id, row.startedOn && row.completedOn ? `${row.startedOn} to ${row.completedOn}` : undefined]));
  const reads = (tx !== db && transactionStatementReads.get(tx)) || new Map<string, Promise<GhgStatement>>();
  if (tx !== db) transactionStatementReads.set(tx, reads);
  const busyStatements = new Set(statementRows.filter(row => isLockedInFlight(row) || !isTerminalAttemptStatus(row.status)).map(row => row.localEntityId));
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
    const canRefresh = fresh && !submissions.some(row => isLockedInFlight(row) || !isTerminalAttemptStatus(row.status));
    return { id, label: labelsById.get(id), submissions: submissions.map(submissionFact),
      statements: await Promise.all(covering.map(row => readStatement(ctx, tx, row, canRefresh && !busyStatements.has(row.localEntityId), reads))) };

  }));
}

async function readStatement(ctx: OrgContext, tx: Pick<DbTransaction, "select">, row: Submission, fresh: boolean, reads: StatementReads): Promise<RecordLockStatement> {
  const savedStatus = getMetadataValue(row.metadata, "remoteStatus");
  const savedSubmitted = getMetadataValue(row.metadata, "submittedToVerifierAt");
  const fact: RecordLockStatement = { id: row.localEntityId,
    status: typeof savedStatus === "string" ? savedStatus : null,
    fresh: false, submittedToVerifier: typeof savedSubmitted === "string" && Number.isFinite(Date.parse(savedSubmitted)),
    removalExternalIds: Array.isArray(getMetadataValue(row.metadata, "removalIds")) ? getMetadataValue(row.metadata, "removalIds") as string[] : [],
    inFlight: isLockedInFlight(row) || !isTerminalAttemptStatus(row.status),
  };
  const canReopen = savedStatus === "FAILED_VERIFICATION" || (savedStatus === "DRAFT" && fact.submittedToVerifier);
  if (!fresh || !row.externalId || fact.inFlight || !canReopen) return fact;
  try {
    const { resolveIsometricClient } = await import("./certifier-credentials");
    const key = `${ctx.organizationId}:${row.externalId}`;
    if (!reads.has(key)) {
      reads.set(key, (async () => {
        const client = await resolveIsometricClient(ctx, tx);
        const deadline = getTransactionDeadline(tx);
        const timeoutMs = Math.min(STATEMENT_REFRESH_TIMEOUT_MS,
          deadline === undefined ? STATEMENT_REFRESH_TIMEOUT_MS : deadline - Date.now() - TRANSACTION_FINISH_RESERVE_MS);
        if (timeoutMs <= 0) throw new Error("No statement refresh budget remains");
        return getGhgStatement(client, row.externalId!, { signal: AbortSignal.timeout(timeoutMs) });
      })());
    }
    const remote = await reads.get(key)!;
    return { ...fact, status: remote.status, fresh: true,
      // REST has no return timestamp. A verifier submission is a conservative
      // lower bound for its subsequent return, never the time of this read.
      returnedAt: remote.submitted_at ?? (typeof savedSubmitted === "string" ? savedSubmitted : null),
      removalExternalIds: remote.ghg_entry_ids,
      submittedToVerifier: fact.submittedToVerifier || Boolean(remote.submitted_at && Number.isFinite(Date.parse(remote.submitted_at))) };
  } catch (error) {
    const { logger } = await import("@/lib/log");
    logger.warn({ organizationId: ctx.organizationId, statementId: row.localEntityId,
      errorName: error instanceof Error && ["Error", "TypeError", "IsometricApiError"].includes(error.name) ? error.name : "UnknownError",
    }, "Record lock statement refresh failed");
    // A failed registry read cannot authorize an edit of previously sent data.
    return fact;
  }
}

function submissionFact(row: Submission) {
  return { id: row.id, externalId: row.externalId, submittedAt: row.submittedAt?.toISOString() ?? null, createdAt: row.createdAt?.toISOString() ?? null, status: row.status, inFlight: isLockedInFlight(row),
    hasRemoteMutation: submissionHasRemoteEffect(row) };
}
