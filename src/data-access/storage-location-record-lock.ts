import { and, eq, or } from 'drizzle-orm';
import type { DbTransaction } from '@/db';
import { biocharProducts, feedstocks, productionRuns } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
import { recordLocks } from '@/lib/record-lock';
import { getCertifiedLineage, lockCertifiedLineageArtifacts, assertLockedLineagesAllowMutation, type CertifiedLineageTarget } from './certification-lineage-guards';
import { requireOrgScope } from './utils';

/** Called under the bin lock, before its row lock, so contained lineage cannot be replaced. */
export async function lockStorageLocationRecords(ctx: OrgContext, tx: DbTransaction, storageLocationId: string) {
  requireOrgScope(ctx);
  const inputs = await tx.select({ id: feedstocks.id }).from(feedstocks).where(and(eq(feedstocks.organizationId, ctx.organizationId), eq(feedstocks.storageLocationId, storageLocationId)));
  const runs = await tx.select({ id: productionRuns.id }).from(productionRuns).where(and(eq(productionRuns.organizationId, ctx.organizationId), eq(productionRuns.biocharStorageLocationId, storageLocationId)));
  const products = await tx.select({ id: biocharProducts.id }).from(biocharProducts).where(and(eq(biocharProducts.organizationId, ctx.organizationId), or(eq(biocharProducts.storageLocationId, storageLocationId), eq(biocharProducts.sourceBiocharStorageLocationId, storageLocationId))));
  const targets: CertifiedLineageTarget[] = [
    ...inputs.map(row => ({ entityType: 'feedstock' as const, entityId: row.id })),
    ...runs.map(row => ({ entityType: 'productionRun' as const, entityId: row.id })),
    ...products.map(row => ({ entityType: 'biocharProduct' as const, entityId: row.id })),
  ];
  const keys = await lockCertifiedLineageArtifacts(ctx, tx, targets);
  await assertLockedLineagesAllowMutation(ctx, tx, keys, targets.map(target => ({ target, mutation: "update", subjectEntityType: target.entityType })));
  const removals = [];
  for (const target of targets) removals.push(...(await getCertifiedLineage(ctx, tx, target)).map(row => row.recordLockRemoval));
  return recordLocks.storageLocation({ removals, dependents: targets.map(target => ({ kind: target.entityType, id: target.entityId })) });
}
