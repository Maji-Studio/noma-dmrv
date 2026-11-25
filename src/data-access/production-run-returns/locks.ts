import { and, eq } from 'drizzle-orm';
import type { DbTransaction } from '@/db';
import { productionRuns } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
import { DomainError } from '@/lib/domain-errors';
import { requestFingerprint } from '../bin-movement-requests';
import { assertLockedLineagesAllowMutation, tryLockCertifiedLineageArtifacts } from '../certification-lineage-guards';
import { lockActiveFacilityReference } from '../facility-reference-guards';
import { assertStockLockSnapshot, lockBinStock } from '../lock-bin-stocks';
import { readRecordDependents } from '../record-lock-dependents';
import { requireOrgScope } from '../utils';
import { getProductionRunReturnAllowance, readReturnSource } from './queries';

/** Facility references, sorted bins, source row, then nonblocking artifact locks. */
export async function lockReturnSource(ctx: OrgContext, tx: DbTransaction, sourceProductionRunId: string, destinationIds: readonly string[]) {
  requireOrgScope(ctx);
  const before = await readReturnSource(ctx, tx, sourceProductionRunId);
  await lockActiveFacilityReference(ctx, tx, before.run.facilityId);
  const binIds = [...new Set([...before.draws.map(row => row.storageLocationId), ...destinationIds])].sort();
  for (const id of binIds) await lockBinStock(ctx, tx, id, { allowArchived: !destinationIds.includes(id) });
  await tx.select({ id: productionRuns.id }).from(productionRuns).where(and(eq(productionRuns.organizationId, ctx.organizationId), eq(productionRuns.id, sourceProductionRunId))).for('update');
  const after = await readReturnSource(ctx, tx, sourceProductionRunId);
  assertStockLockSnapshot(requestFingerprint(before) === requestFingerprint(after));
  const target = { entityType: 'productionRun' as const, entityId: sourceProductionRunId };
  const keys = await tryLockCertifiedLineageArtifacts(ctx, tx, [target]);
  if (!keys) throw new DomainError('concurrent_write_retry', 'Certification is changing. Try again shortly.', { retryable: true });
  await assertLockedLineagesAllowMutation(ctx, tx, keys, [{ target, mutation: 'update' }]);
  const source = await getProductionRunReturnAllowance(ctx, sourceProductionRunId, tx);
  const returnIds = new Set(source.history.map(row => row.id));
  const dependents = await readRecordDependents(ctx, tx, target);
  // Another return shares the cap; it is not a reason to refuse a further return or correction.
  if (dependents.some(dependent => dependent.kind !== 'stockEntry' || !returnIds.has(dependent.id))) throw new DomainError('certification_locked', 'The run is in use. Correct its dependent records before returning material.');
  return source;
}
