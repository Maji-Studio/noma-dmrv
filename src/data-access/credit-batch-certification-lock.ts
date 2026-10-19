import { and, eq, isNotNull } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import {
  certifierRemovals,
} from "@/db/schema/certification";
import { creditBatchApplications } from "@/db/schema/credits";
import { acquireCertificationArtifactLocksSorted } from "@/lib/certification/submission-lock";
import { formatCertificationLineageLockMessage } from "@/lib/certification/lineage-lock-message";
import { recordLocks, withRecordLockGuidance } from "@/lib/record-lock";
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
  tx: DbTransaction,
  creditBatchId: string,
  lock = false,
) {
  requireOrgScope(ctx);
  const query = tx
    .select({
      id: certifierRemovals.id,
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

  const facts = await readRecordLockLineage(ctx, tx, removals.map(row => ({ removalId: row.id, ghgStatementId: row.ghgStatementId })), true);
  return recordLocks.creditBatch({ removals: facts, dependents: [] });
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
