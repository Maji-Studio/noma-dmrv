import { db } from '@/db';
import type { OrgContext } from '@/lib/auth/server';
import { SafeError } from '@/lib/errors';
import { outputStockPostSchema } from '@/schemas/output-stock';
import type { OutputStockPostInput } from '@/types/output-stock';
import { recordOutputStockMovementInTransaction } from './output-stock-post';
import { requireOrgScope } from './utils';

/** Browser stock edits require the latest entry; API corrections keep their dependency contract. */
export async function correctOutputStockEntry(ctx: OrgContext, raw: OutputStockPostInput) {
  requireOrgScope(ctx);
  const input = outputStockPostSchema.parse(raw);
  if (!['loss', 'delivery'].includes(input.kind) || !input.correctsMovementId) throw new SafeError('Choose a Lost mass or delivery entry to edit.');
  return db.transaction(tx => recordOutputStockMovementInTransaction(ctx, tx, input, { requireLatestCorrection: true }));
}
