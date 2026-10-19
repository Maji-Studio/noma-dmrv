import { and, eq, or } from 'drizzle-orm';
import type { DbTransaction } from '@/db';
import { biocharProducts, feedstocks, productionRuns } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
import { DomainError } from '@/lib/domain-errors';
import { recordLocks, type RecordLockRemoval } from '@/lib/record-lock';
import { recordFieldEqual } from '@/lib/record-lock-fields';
import {
  CertificationLineageChangedError,
  getCertifiedLineage,
  getLineageUnderLockedArtifacts,
  tryLockCertifiedLineageArtifacts,
  type CertifiedLineageTarget,
} from './certification-lineage-guards';
import { requireOrgScope } from './utils';

/** Columns that choose the bin's material lane or scope. Only these need the authoritative Sent check. */
const PROTECTED_STORAGE_LOCATION_FIELDS = ['type', 'feedstockTypeId', 'formulationId', 'facilityId'] as const;
const STORAGE_LOCATION_LINEAGE_BUSY = 'Certification records in this storage bin are being changed. Save again in a moment.';

type ProtectedField = (typeof PROTECTED_STORAGE_LOCATION_FIELDS)[number];

/** True when `changes` moves a protected column away from `existing`. */
export function changesProtectedStorageLocationField(existing: Partial<Record<ProtectedField, unknown>>, changes: Partial<Record<ProtectedField, unknown>>): boolean {
  return PROTECTED_STORAGE_LOCATION_FIELDS.some(field => changes[field] !== undefined && !recordFieldEqual(field, existing[field], changes[field]));
}

async function readStorageLocationTargets(ctx: OrgContext, tx: DbTransaction, storageLocationId: string): Promise<CertifiedLineageTarget[]> {
  const inputs = await tx.select({ id: feedstocks.id }).from(feedstocks).where(and(eq(feedstocks.organizationId, ctx.organizationId), eq(feedstocks.storageLocationId, storageLocationId)));
  const runs = await tx.select({ id: productionRuns.id }).from(productionRuns).where(and(eq(productionRuns.organizationId, ctx.organizationId), eq(productionRuns.biocharStorageLocationId, storageLocationId)));
  const products = await tx.select({ id: biocharProducts.id }).from(biocharProducts).where(and(eq(biocharProducts.organizationId, ctx.organizationId), or(eq(biocharProducts.storageLocationId, storageLocationId), eq(biocharProducts.sourceBiocharStorageLocationId, storageLocationId))));
  return [
    ...inputs.map(row => ({ entityType: 'feedstock' as const, entityId: row.id })),
    ...runs.map(row => ({ entityType: 'productionRun' as const, entityId: row.id })),
    ...products.map(row => ({ entityType: 'biocharProduct' as const, entityId: row.id })),
  ];
}

/** The path was chosen from a pre-lock read; a protected column that moved since needs the locked path. */
export function assertProtectedChangesLocked(lineageLocked: boolean, existing: Partial<Record<ProtectedField, unknown>>, changes: Partial<Record<ProtectedField, unknown>>): void {
  if (!lineageLocked && changesProtectedStorageLocationField(existing, changes)) throw lineageBusy();
}

function storageLocationRecordLock(targets: CertifiedLineageTarget[], removals: RecordLockRemoval[]) {
  return recordLocks.storageLocation({ removals, dependents: targets.map(target => ({ kind: target.entityType, id: target.entityId })) });
}

function lineageBusy(): DomainError {
  return new DomainError('concurrent_write_retry', STORAGE_LOCATION_LINEAGE_BUSY, { retryable: true });
}

/**
 * Advisory Sent check under the bin lock, for free-field updates only: they
 * take no artifact locks, so a lineage sent mid-save can still accept a rename.
 */
export async function readStorageLocationRecordLock(ctx: OrgContext, tx: DbTransaction, storageLocationId: string) {
  requireOrgScope(ctx);
  const targets = await readStorageLocationTargets(ctx, tx, storageLocationId);
  const removals = [];
  for (const target of targets) removals.push(...(await getCertifiedLineage(ctx, tx, target)).map(row => row.recordLockRemoval));
  return storageLocationRecordLock(targets, removals);
}

/**
 * Authoritative lock facts for a protected-field update. Called under the bin
 * stock lock and before the bin row lock. Feedstock writers take artifacts
 * before this bin, so waiting on an artifact here could deadlock: every
 * artifact is TRY-locked in sorted order and contention aborts with a
 * retryable conflict. Lineage is then re-read fresh; an artifact outside the
 * held set also aborts. The locks stay held to commit, so a Removal claim or
 * verifier resubmission cannot make the lineage Sent before this write lands.
 */
export async function lockStorageLocationRecordsWithoutWaiting(ctx: OrgContext, tx: DbTransaction, storageLocationId: string) {
  requireOrgScope(ctx);
  const lockedKeys = await tryLockCertifiedLineageArtifacts(ctx, tx, await readStorageLocationTargets(ctx, tx, storageLocationId));
  if (!lockedKeys) throw lineageBusy();
  // Re-discover too: a contained record added since discovery has unlocked lineage.
  const targets = await readStorageLocationTargets(ctx, tx, storageLocationId);
  const removals = [];
  try {
    for (const target of targets) removals.push(...(await getLineageUnderLockedArtifacts(ctx, tx, lockedKeys, target)).map(row => row.recordLockRemoval));
  } catch (error) {
    if (error instanceof CertificationLineageChangedError) throw lineageBusy();
    throw error;
  }
  return storageLocationRecordLock(targets, removals);
}
