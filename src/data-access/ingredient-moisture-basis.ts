import { db, type DbTransaction } from '@/db';
import { feedstocks } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
import { and, asc, eq, isNull, lte } from 'drizzle-orm';
import { z } from 'zod';
import { requireOrgScope } from './utils';

/** The oldest eligible recorded intake is the default; later drying never edits it. */
export async function getIngredientMoistureBasis(ctx: OrgContext, storageLocationId: string, physicalDate?: string, reader: Pick<DbTransaction, 'select'> = db) {
  requireOrgScope(ctx);
  if (physicalDate) z.iso.date().parse(physicalDate);
  const [intake] = await reader.select({ id: feedstocks.id, moisturePercent: feedstocks.moistureContentPercent }).from(feedstocks)
    .where(and(eq(feedstocks.organizationId, ctx.organizationId), eq(feedstocks.storageLocationId, storageLocationId), isNull(feedstocks.archivedAt),
      physicalDate ? lte(feedstocks.deliveryDate, new Date(`${physicalDate}T23:59:59.999Z`)) : undefined))
    .orderBy(asc(feedstocks.deliveryDate), asc(feedstocks.createdAt), asc(feedstocks.id)).limit(1);
  return intake ?? null;
}
