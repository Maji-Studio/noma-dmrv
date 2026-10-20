import { SafeError } from "@/lib/errors";
import { and, eq, inArray } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { applications, certificationSubmissions, creditBatchApplications, creditBatches } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { emissionsEntriesEnabled } from "@/lib/certification/emissions-entry-gate";
import { deriveRemovalEntryWindow, type RemovalEntryWindow } from "@/lib/certification/removal-emission-contributions";
import { isRemovalCorrectionWindowOpen } from "@/lib/record-lock";
import { CertificationLineageChangedError, getCertifiedLineage, getLockedCertifiedLineageForBatches } from "./certification-lineage-guards";
import { requireOrgScope, type Executor } from "./utils";

type CorrectionScope = { batchIds: string[]; artifactIds: Set<string>; windows: Map<string, RemovalEntryWindow> };
const scopes = new WeakMap<DbTransaction, Map<string, CorrectionScope>>();
const scopeKey = (ctx: OrgContext, batchId: string) => `${ctx.organizationId}:${batchId}`;

/** Before batch/entry rows: acquire the same artifact locks as statement submission. */
export async function lockEmissionCorrectionScope(ctx: OrgContext, tx: DbTransaction, batchId: string) {
  requireOrgScope(ctx);
  if (!emissionsEntriesEnabled()) return;
  const key = scopeKey(ctx, batchId);
  if (scopes.get(tx)?.has(key)) return;
  const batchIds = await emissionCorrectionBatchIds(ctx, tx, batchId);
  const lineage = await getLockedCertifiedLineageForBatches(ctx, tx, batchIds);
  const facts = lineage.map((row) => row.recordLockRemoval);
  const ids = facts.filter((fact) => isRemovalCorrectionWindowOpen(fact, facts)).map((fact) => fact.id);
  const members = ids.length ? await tx.select({ removalId: creditBatchApplications.removalId, startDate: creditBatches.startDate, applicationDate: applications.applicationDate })
    .from(creditBatchApplications)
    .innerJoin(creditBatches, and(eq(creditBatches.organizationId, ctx.organizationId), eq(creditBatches.id, creditBatchApplications.creditBatchId)))
    .innerJoin(applications, and(eq(applications.organizationId, ctx.organizationId), eq(applications.id, creditBatchApplications.applicationId)))
    .where(and(eq(creditBatchApplications.organizationId, ctx.organizationId), inArray(creditBatchApplications.removalId, ids))) : [];
  const windows = new Map<string, RemovalEntryWindow>();
  for (const id of ids) {
    const group = members.filter((row) => row.removalId === id);
    const window = deriveRemovalEntryWindow(group, group.map((row) => row.applicationDate));
    if (window) windows.set(id, window);
  }
  const cache = scopes.get(tx) ?? new Map<string, CorrectionScope>();
  cache.set(key, { batchIds, windows, artifactIds: new Set(facts.flatMap((fact) => [`removal:${fact.id}`, ...fact.statements.map((statement) => `statement:${statement.id}`)])) });
  scopes.set(tx, cache);
}

/** After the batch lock, fail if membership introduced an artifact we did not fence. */
export async function revalidateEmissionCorrectionScope(ctx: OrgContext, tx: DbTransaction, batchId: string) {
  requireOrgScope(ctx);
  const scope = scopes.get(tx)?.get(scopeKey(ctx, batchId));
  if (!scope) return;
  const lineage = (await Promise.all(scope.batchIds.map((id) => getCertifiedLineage(ctx, tx, { entityType: "creditBatch", entityId: id })))).flat();
  const facts = lineage.map((row) => row.recordLockRemoval);
  if (facts.some((fact) => !scope.artifactIds.has(`removal:${fact.id}`) || fact.statements.some((statement) => !scope.artifactIds.has(`statement:${statement.id}`)))) {
    throw new CertificationLineageChangedError();
  }
  for (const id of scope.windows.keys()) {
    const fact = facts.find((item) => item.id === id);
    if (!fact || !isRemovalCorrectionWindowOpen(fact, facts)) scope.windows.delete(id);
  }
}

/** Only a scope acquired before the batch lock may authorize a sent-entry write. */
export function emissionCorrectionWindow(ctx: OrgContext, tx: DbTransaction, batchId: string, removalId: string) {
  requireOrgScope(ctx);
  return emissionsEntriesEnabled() ? scopes.get(tx)?.get(scopeKey(ctx, batchId))?.windows.get(removalId) : undefined;
}

/** New attempts are allowed only after the registry returned the prior submission.
 * Recovery of possible remote effects retains the locks without reopening entry writes.
 * Called before the claim's own artifact lock so the union keeps global order.
 */
export async function lockRemovalEntryCorrectionAttempt(ctx: OrgContext, tx: DbTransaction, removalId: string, excludeSubmissionId?: string, reconcileExternalMutation = false) {
  requireOrgScope(ctx);
  if (!emissionsEntriesEnabled()) return;
  const prior = await tx.select().from(certificationSubmissions).where(and(
    eq(certificationSubmissions.organizationId, ctx.organizationId), eq(certificationSubmissions.localEntityType, "removal"),
    eq(certificationSubmissions.localEntityId, removalId), eq(certificationSubmissions.submissionType, "removal"),
  ));
  if (!prior.some((row) => row.id !== excludeSubmissionId && row.submittedAt)) return;
  const members = await tx.select({ id: creditBatchApplications.creditBatchId }).from(creditBatchApplications).where(and(
    eq(creditBatchApplications.organizationId, ctx.organizationId), eq(creditBatchApplications.removalId, removalId),
  ));
  const lineage = await getLockedCertifiedLineageForBatches(ctx, tx, members.map((row) => row.id), excludeSubmissionId);
  const facts = lineage.map((row) => row.recordLockRemoval);
  const removal = facts.find((fact) => fact.id === removalId);
  if (!reconcileExternalMutation && (!removal || !isRemovalCorrectionWindowOpen(removal, facts)))
    throw new SafeError("This Removal is sent. If Isometric sends the GHG Statement back, refresh its status to correct it.");
}

/** The same one-hop batch union governs advisory and locked correction eligibility. */
export async function emissionCorrectionBatchIds(ctx: OrgContext, executor: Executor, batchId: string) {
  requireOrgScope(ctx);
  const owners = await executor.select({ id: creditBatchApplications.removalId }).from(creditBatchApplications).where(and(
    eq(creditBatchApplications.organizationId, ctx.organizationId), eq(creditBatchApplications.creditBatchId, batchId),
  ));
  const ownerIds = owners.flatMap((row) => row.id ? [row.id] : []);
  const shared = ownerIds.length ? await executor.select({ id: creditBatchApplications.creditBatchId }).from(creditBatchApplications).where(and(
    eq(creditBatchApplications.organizationId, ctx.organizationId), inArray(creditBatchApplications.removalId, ownerIds),
  )) : [];
  return [...new Set([batchId, ...shared.map((row) => row.id)])];
}
