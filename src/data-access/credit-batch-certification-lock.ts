import { and, eq, isNotNull } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import {
  certifierRemovals,
} from "@/db/schema/certification";
import { creditBatchApplications } from "@/db/schema/credits";
import { acquireCertificationArtifactLocksSorted } from "@/lib/certification/submission-lock";
import { formatCertificationLineageLockMessage } from "@/lib/certification/lineage-lock-message";
import { isRemoteSubmission, recordLocks, withRecordLockGuidance } from "@/lib/record-lock";
import { DomainError } from "@/lib/domain-errors";
import { readRecordLockLineage } from "./record-lock-lineage";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import { requireOrgScope } from "./utils";

const CERTIFIER_PROVIDER = "isometric" as const;

export class CreditBatchLineageChangedError extends SafeError {
  constructor() {
    super("Certification lineage changed while it was being locked. Refresh and retry.");
    this.name = "CreditBatchLineageChangedError";
  }
}

async function readCreditBatchRemovals(
  ctx: OrgContext,
  tx: Pick<DbTransaction, "select">,
  creditBatchId: string,
  lock = false,
) {
  requireOrgScope(ctx);
  const query = tx
    .select({
      id: certifierRemovals.id,
      code: certifierRemovals.code,
      ghgStatementId: certifierRemovals.ghgStatementId,
    })
    .from(creditBatchApplications)
    .innerJoin(
      certifierRemovals,
      and(
        eq(certifierRemovals.id, creditBatchApplications.removalId),
        eq(certifierRemovals.organizationId, ctx.organizationId),
      ),
    )
    .where(
      and(
        eq(creditBatchApplications.creditBatchId, creditBatchId),
        eq(creditBatchApplications.organizationId, ctx.organizationId),
      ),
    )
    .orderBy(certifierRemovals.id);
  // Keep lineage stable without waiting on a Removal lifecycle transaction
  // that may hold its row while waiting for our artifact lock. An incomplete
  // result fails the snapshot comparison below and asks the caller to retry.
  const removalRows = await (lock ? query.for("update", { skipLocked: true }) : query);
  const removals = [
    ...new Map(removalRows.map((removal) => [removal.id, removal])).values(),
  ];
  const facts = await readRecordLockLineage(ctx, tx, removals.map(row => ({ removalId: row.id, ghgStatementId: row.ghgStatementId })));
  return removals.map(row => ({ ...row, statementIds: [...new Set([
    ...(row.ghgStatementId ? [row.ghgStatementId] : []),
    ...facts.find(fact => fact.id === row.id)!.statements.map(statement => statement.id),
  ])].sort() }));
}

type CreditBatchRemovals = Awaited<ReturnType<typeof readCreditBatchRemovals>>;

/** Acquire artifacts from an unlocked read, before taking any batch row lock. */
export async function lockCreditBatchArtifacts(
  ctx: OrgContext,
  tx: DbTransaction,
  creditBatchId: string,
): Promise<CreditBatchRemovals> {
  const removals = await readCreditBatchRemovals(ctx, tx, creditBatchId);
  await acquireCertificationArtifactLocksSorted(tx, [
    ...removals.map((removal) => ({
      provider: CERTIFIER_PROVIDER,
      localEntityType: "removal",
      localEntityId: removal.id,
    } as const)),
    ...removals.flatMap(removal => removal.statementIds.map(id => ({
      provider: CERTIFIER_PROVIDER, localEntityType: "ghgStatement", localEntityId: id,
    }))),
  ]);

  return removals;
}

/** Re-resolve under the batch lock; never acquire newly discovered artifacts here. */
async function creditBatchMembershipLock(
  ctx: OrgContext,
  tx: DbTransaction,
  creditBatchId: string,
  lockedRemovals: CreditBatchRemovals,
) {
  const removals = await readCreditBatchRemovals(ctx, tx, creditBatchId, true);
  if (
    removals.length !== lockedRemovals.length ||
    removals.some((removal, index) =>
      removal.id !== lockedRemovals[index].id ||
      removal.ghgStatementId !== lockedRemovals[index].ghgStatementId ||
      JSON.stringify(removal.statementIds) !== JSON.stringify(lockedRemovals[index].statementIds),
    )
  ) {
    throw new CreditBatchLineageChangedError();
  }

  return readMembershipLock(ctx, tx, removals, true);
}

async function readMembershipLock(
  ctx: OrgContext,
  executor: Pick<DbTransaction, "select">,
  removals: CreditBatchRemovals,
  fresh = false,
) {
  const facts = await readRecordLockLineage(ctx, executor, removals.map(row => ({ removalId: row.id, ghgStatementId: row.ghgStatementId })), fresh);
  return recordLocks.creditBatch({ removals: facts, dependents: [] });
}

/** Read cached submission lineage without row/advisory locks or registry calls. */
export async function readCreditBatchMembershipSubmissionLock(
  ctx: OrgContext,
  executor: Pick<DbTransaction, "select">,
  creditBatchId: string,
): Promise<boolean> {
  requireOrgScope(ctx);
  const removals = await readCreditBatchRemovals(ctx, executor, creditBatchId, false);
  return (await readMembershipLock(ctx, executor, removals)).level === "sent";
}

export async function isCreditBatchMembershipLockedBySubmission(ctx: OrgContext, tx: DbTransaction, creditBatchId: string, lockedRemovals: CreditBatchRemovals): Promise<boolean> {
  return (await creditBatchMembershipLock(ctx, tx, creditBatchId, lockedRemovals)).level === "sent";
}

export async function assertRemovalAllowsCreditBatchMutation(
  ctx: OrgContext,
  tx: DbTransaction,
  creditBatchId: string,
  mutation: "update" | "delete",
  lockedRemovals: CreditBatchRemovals,
): Promise<void> {
  const lock = await creditBatchMembershipLock(ctx, tx, creditBatchId, lockedRemovals);
  if (lock.level !== "sent") return;

  throw new DomainError(
    "certification_locked",
    formatCertificationLineageLockMessage({
      lock,
      mutation,
      subjectEntityType: "creditBatch",
      lineageEntityType: "creditBatch",
    }),
  );
}

/** After lineage revalidation under the batch/artifact locks, remote ownership survives a return. */
export async function assertNoRemoteRemovalHoldsCreditBatch(
  ctx: OrgContext,
  tx: DbTransaction,
  batch: { code: string; lockedRemovals: CreditBatchRemovals },
): Promise<void> {
  requireOrgScope(ctx);
  const facts = await readRecordLockLineage(ctx, tx, batch.lockedRemovals.map(removal => ({
    removalId: removal.id, ghgStatementId: removal.ghgStatementId,
  })));
  const remoteRemovalIds = new Set(facts.filter(removal => removal.submissions.some(isRemoteSubmission)).map(removal => removal.id));
  const holder = batch.lockedRemovals.find(removal => remoteRemovalIds.has(removal.id));
  if (!holder) return;

  throw new DomainError(
    "certification_locked",
    `Credit batch ${batch.code} is in Removal ${holder.code}, which was sent to Isometric, so it cannot be deleted. Correct its records instead, then resubmit Removal ${holder.code}.`,
  );
}

export async function assertCreditBatchSlicesAreUnassigned(
  ctx: OrgContext,
  tx: DbTransaction,
  creditBatchId: string,
): Promise<void> {
  const [assignedSlice] = await tx
    .select({ removalId: creditBatchApplications.removalId })
    .from(creditBatchApplications)
    .where(
      and(
        eq(creditBatchApplications.creditBatchId, creditBatchId),
        isNotNull(creditBatchApplications.removalId),
        eq(creditBatchApplications.organizationId, ctx.organizationId),
      ),
    )
    .for("update")
    .limit(1);
  if (!assignedSlice) return;

  const lock = recordLocks.creditBatch({ removals: [], dependents: [{ kind: "removal", id: assignedSlice.removalId! }] });
  throw new DomainError("certification_locked", withRecordLockGuidance(
    "Cannot change this credit batch's production membership because its applied mass belongs to a Removal.", lock));
}
