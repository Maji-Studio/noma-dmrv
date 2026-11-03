import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { feedstockBinMethodChanges } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
import type { FeedstockMethodChange } from '@/lib/feedstock-draw-replay';
import { requireOrgScope } from './utils';

export async function getFeedstockMethodChanges(ctx: OrgContext, storageLocationId: string,
  reader: Pick<typeof db, 'select'> = db): Promise<FeedstockMethodChange[]> {
  requireOrgScope(ctx);
  const rows = await reader.select().from(feedstockBinMethodChanges).where(and(
    eq(feedstockBinMethodChanges.organizationId, ctx.organizationId), eq(feedstockBinMethodChanges.storageLocationId, storageLocationId),
  ));
  return rows.map(row => ({ ...row, effectiveAt: row.effectiveAt.toISOString(), createdAt: row.createdAt.toISOString() }));
}
