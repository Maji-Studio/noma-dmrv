import { isRegistryMissingSubmission } from "@/lib/certification/removal-registry-presence";
import { EMISSION_ENTRY_OUTSIDE_CORRECTION_WINDOW } from "@/lib/certification/emission-entry-messages";
import { SafeError } from "@/lib/errors";
import { and, eq, inArray } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { applications, certificationSubmissions, creditBatchApplications, creditBatches, emissionEntries } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { deriveRemovalEntryWindow, inWindow, type RemovalEntryWindow } from "@/lib/certification/removal-emission-contributions";
import { isRemovalCorrectionWindowOpen, type RecordLockRemoval } from "@/lib/record-lock";
import { CertificationLineageChangedError, getCertifiedLineage, getLockedCertifiedLineageForBatches } from "./certification-lineage-guards";
import { requireOrgScope, type Executor } from "./utils";
import { loadEmissionEntryHolds } from "./emission-entry-holds";
import { listCarryRemovalMembers } from "./emission-entry-carry-queries";
import { getLatestTemplateObservation } from "./removal-template-observations";
import { resolveBatchPin } from "@/lib/certification/resolve-batch-pin";

type CorrectionWindow = { window: RemovalEntryWindow; carried: boolean };
type CorrectionScope = { batchIds: string[]; receiverIds: Set<string>; artifactIds: Set<string>; windows: Map<string, CorrectionWindow> };
const scopes = new WeakMap<DbTransaction, Map<string, CorrectionScope>>();
const scopeKey = (ctx: OrgContext, batchId: string) => `${ctx.organizationId}:${batchId}`;

/** Before batch/entry rows: acquire the same artifact locks as statement submission. */
export async function lockEmissionCorrectionScope(ctx: OrgContext, tx: DbTransaction, batchId: string) {
  requireOrgScope(ctx);
  const key = scopeKey(ctx, batchId);
  if (scopes.get(tx)?.has(key)) return;
  const discovery = await discoverEmissionCorrectionScope(ctx, tx, batchId);
  const { batchIds } = discovery;
  const lineage = await getLockedCertifiedLineageForBatches(ctx, tx, batchIds);
  const facts = lineage.map((row) => row.recordLockRemoval);
  const windows = await loadCorrectionWindows(ctx, tx, batchId, discovery, facts);
  const cache = scopes.get(tx) ?? new Map<string, CorrectionScope>();
  cache.set(key, { batchIds, receiverIds: new Set(discovery.receiverUnions.keys()), windows, artifactIds: new Set(facts.flatMap((fact) => [`removal:${fact.id}`, ...fact.statements.map((statement) => `statement:${statement.id}`)])) });
  scopes.set(tx, cache);
}

/** After the batch lock, fail if membership introduced an artifact we did not fence. */
export async function revalidateEmissionCorrectionScope(ctx: OrgContext, tx: DbTransaction, batchId: string) {
  requireOrgScope(ctx);
  const scope = scopes.get(tx)?.get(scopeKey(ctx, batchId));
  if (!scope) return;
  const discovery = await discoverEmissionCorrectionScope(ctx, tx, batchId);
  const { batchIds } = discovery;
  if ([...discovery.receiverUnions.keys()].some(id => !scope.receiverIds.has(id))) throw new CertificationLineageChangedError();
  const lineage = (await Promise.all([...new Set([...scope.batchIds, ...batchIds])].map((id) => getCertifiedLineage(ctx, tx, { entityType: "creditBatch", entityId: id })))).flat();
  const facts = lineage.map((row) => row.recordLockRemoval);
  if (facts.some((fact) => !scope.artifactIds.has(`removal:${fact.id}`) || fact.statements.some((statement) => !scope.artifactIds.has(`statement:${statement.id}`)))) {
    throw new CertificationLineageChangedError();
  }
  const windows = await loadCorrectionWindows(ctx, tx, batchId, discovery, facts);
  for (const id of scope.windows.keys()) {
    if (!windows.has(id)) scope.windows.delete(id);
  }
}

/** Only a scope acquired before the batch lock may authorize a sent-entry write. */
export function emissionCorrectionWindow(ctx: OrgContext, tx: DbTransaction, batchId: string, removalId: string) {
  requireOrgScope(ctx);
  return scopes.get(tx)?.get(scopeKey(ctx, batchId))?.windows.get(removalId)?.window;
}

/** Membership is captured under the same artifact locks as correction eligibility. */
export function isCarriedEmissionCorrection(ctx: OrgContext, tx: DbTransaction, batchId: string, removalId: string) {
  requireOrgScope(ctx);
  return scopes.get(tx)?.get(scopeKey(ctx, batchId))?.windows.get(removalId)?.carried === true;
}

/** Read the receiver's member-batch pin only within its locked correction scope. */
export async function loadEmissionCorrectionReceiverObservation(
  ctx: OrgContext, tx: DbTransaction, batchId: string, removalId: string, facilityId: string,
) {
  requireOrgScope(ctx);
  const scope = scopes.get(tx)?.get(scopeKey(ctx, batchId));
  if (!scope?.windows.get(removalId)?.carried) return null;
  const members = await listCarryRemovalMembers(ctx, facilityId, tx, scope.batchIds);
  const batches = members.filter(row => row.removal.id === removalId).map(row => row.batch);
  if (batches.some(batch => batch.facilityId !== facilityId)) return null;
  const pin = resolveBatchPin(batches);
  if ("code" in pin) return null;
  return getLatestTemplateObservation(ctx, "isometric", pin.pin, tx);
}

export function assertSentEntryInCorrectionWindow(
  ctx: OrgContext, tx: DbTransaction, batchId: string, removalId: string, occurredOn: string,
) {
  requireOrgScope(ctx);
  const window = emissionCorrectionWindow(ctx, tx, batchId, removalId);
  if (!window || !(isCarriedEmissionCorrection(ctx, tx, batchId, removalId) ? occurredOn <= window.end : inWindow({ occurredOn }, window)))
    throw new SafeError(EMISSION_ENTRY_OUTSIDE_CORRECTION_WINDOW);
}

/** New attempts are allowed only after the registry returned the prior submission.
 * Recovery of possible remote effects retains the locks without reopening entry writes.
 * Called before the claim's own artifact lock so the union keeps global order.
 */
export async function lockRemovalEntryCorrectionAttempt(ctx: OrgContext, tx: DbTransaction, removalId: string, excludeSubmissionId?: string, reconcileExternalMutation = false) {
  requireOrgScope(ctx);
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
  // A confirmed missing sent version permits rebuilding, never editing its records.
  const lastSent = prior.filter((row) => row.submittedAt).sort((a, b) => b.version - a.version)[0];
  const missingInRegistry = isRegistryMissingSubmission(lastSent);
  if (!reconcileExternalMutation && !missingInRegistry && (!removal || !isRemovalCorrectionWindowOpen(removal, facts)))
    throw new SafeError("This Removal is sent. If Isometric sends the GHG Statement back, refresh its status to correct it.");
}

/** The base one-hop union follows application owners only, as advisory reads require. */
export async function emissionCorrectionBatchIds(ctx: OrgContext, executor: Executor, batchId: string) {
  requireOrgScope(ctx);
  return emissionCorrectionBatchIdsForOwners(ctx, executor, batchId, await emissionCorrectionOwnerIds(ctx, executor, batchId));
}

async function emissionCorrectionOwnerIds(ctx: OrgContext, executor: Executor, batchId: string) {
  requireOrgScope(ctx);
  const owners = await executor.select({ id: creditBatchApplications.removalId }).from(creditBatchApplications).where(and(
    eq(creditBatchApplications.organizationId, ctx.organizationId), eq(creditBatchApplications.creditBatchId, batchId),
  ));
  return owners.flatMap(row => row.id ? [row.id] : []);
}

async function emissionCorrectionBatchIdsForOwners(ctx: OrgContext, executor: Executor, batchId: string, ownerIds: string[]) {
  requireOrgScope(ctx);
  return [...new Set([batchId, ...await emissionCorrectionMemberBatchIds(ctx, executor, ownerIds)])];
}

async function emissionCorrectionMemberBatchIds(ctx: OrgContext, executor: Executor, removalIds: string[]) {
  requireOrgScope(ctx);
  const members = removalIds.length ? await executor.select({ id: creditBatchApplications.creditBatchId }).from(creditBatchApplications).where(and(
    eq(creditBatchApplications.organizationId, ctx.organizationId), inArray(creditBatchApplications.removalId, removalIds),
  )) : [];
  return [...new Set(members.map(row => row.id))];
}

/** Sent, reserved and held receivers, excluding the batch's application owners. */
async function emissionCorrectionReceiverIds(ctx: OrgContext, executor: Executor, batchId: string, directOwnerIds: string[]) {
  requireOrgScope(ctx);
  // Include tombstoned originals: replacements retain their sent Removal as a hold.
  const entries = await executor.select({
    id: emissionEntries.id, replacesEntryId: emissionEntries.replacesEntryId,
    sentByRemovalId: emissionEntries.sentByRemovalId, reservedByRemovalId: certificationSubmissions.localEntityId,
  }).from(emissionEntries).leftJoin(certificationSubmissions, and(
    eq(certificationSubmissions.organizationId, ctx.organizationId),
    eq(certificationSubmissions.id, emissionEntries.sendReservedBySubmissionId),
    eq(certificationSubmissions.localEntityType, "removal"),
  )).where(and(eq(emissionEntries.organizationId, ctx.organizationId), eq(emissionEntries.creditBatchId, batchId)));
  const holds = await loadEmissionEntryHolds(ctx, entries, executor);
  const ownerIds = new Set(directOwnerIds);
  return [...new Set(entries.flatMap(entry => [entry.sentByRemovalId, entry.reservedByRemovalId, holds.get(entry.id)])
    .filter((id): id is string => !!id && !ownerIds.has(id)))];
}

/** Fence every group's artifacts together, but retain each group's own eligibility union. */
export async function discoverEmissionCorrectionScope(ctx: OrgContext, executor: Executor, batchId: string) {
  requireOrgScope(ctx);
  const ownerIds = await emissionCorrectionOwnerIds(ctx, executor, batchId);
  const baseBatchIds = await emissionCorrectionBatchIdsForOwners(ctx, executor, batchId, ownerIds);
  const receiverIds = await emissionCorrectionReceiverIds(ctx, executor, batchId, ownerIds);
  const receiverUnions = new Map<string, string[]>();
  for (const receiverId of receiverIds) {
    const members = await emissionCorrectionMemberBatchIds(ctx, executor, [receiverId]);
    const unions = await Promise.all(members.map(id => emissionCorrectionBatchIds(ctx, executor, id)));
    receiverUnions.set(receiverId, [...new Set(unions.flat())]);
  }
  return { baseBatchIds, receiverUnions, batchIds: [...new Set([...baseBatchIds, ...[...receiverUnions.values()].flat()])] };
}

async function loadCorrectionWindows(
  ctx: OrgContext, executor: Executor, batchId: string,
  discovery: Awaited<ReturnType<typeof discoverEmissionCorrectionScope>>, facts: RecordLockRemoval[],
) {
  requireOrgScope(ctx);
  const ids = facts.map(fact => fact.id);
  const members = ids.length ? await executor.select({ removalId: creditBatchApplications.removalId, creditBatchId: creditBatchApplications.creditBatchId, startDate: creditBatches.startDate, applicationDate: applications.applicationDate })
    .from(creditBatchApplications)
    .innerJoin(creditBatches, and(eq(creditBatches.organizationId, ctx.organizationId), eq(creditBatches.id, creditBatchApplications.creditBatchId)))
    .innerJoin(applications, and(eq(applications.organizationId, ctx.organizationId), eq(applications.id, creditBatchApplications.applicationId)))
    .where(and(eq(creditBatchApplications.organizationId, ctx.organizationId), inArray(creditBatchApplications.removalId, ids))) : [];
  const holders = (union: string[]) => new Set(members.filter(row => union.includes(row.creditBatchId)).map(row => row.removalId));
  const baseHolders = holders(discovery.baseBatchIds);
  const windows = new Map<string, CorrectionWindow>();
  for (const fact of facts) {
    const union = [...new Set([
      ...(baseHolders.has(fact.id) ? discovery.baseBatchIds : []),
      ...(discovery.receiverUnions.get(fact.id) ?? []),
    ])];
    if (!union.length) continue;
    const groupHolders = holders(union);
    if (!isRemovalCorrectionWindowOpen(fact, facts.filter(holder => groupHolders.has(holder.id)))) continue;
    const group = members.filter(row => row.removalId === fact.id);
    const window = deriveRemovalEntryWindow(group, group.map(row => row.applicationDate));
    if (window) windows.set(fact.id, { window, carried: !group.some(row => row.creditBatchId === batchId) });
  }
  return windows;
}

/** Read once per correction union, retaining a result for each distinct batch. */
export async function readPerCorrectionUnion<T>(ctx: OrgContext, executor: Executor, batchIds: readonly string[], read: (union: string[]) => Promise<T>): Promise<Map<string, T>> {
  requireOrgScope(ctx);
  const reads = new Map<string, Promise<T>>();
  return new Map(await Promise.all([...new Set(batchIds)].map(async batchId => {
    const union = await emissionCorrectionBatchIds(ctx, executor, batchId);
    const key = JSON.stringify([...union].sort());
    if (!reads.has(key)) reads.set(key, read(union));
    return [batchId, await reads.get(key)!] as const;
  })));
}
