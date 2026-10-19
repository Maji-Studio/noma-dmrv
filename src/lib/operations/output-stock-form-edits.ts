import type { OrgContext } from '@/lib/auth/server';
import { SafeError } from '@/lib/errors';
import { outputStockPostSchema } from '@/schemas/output-stock';
import type { OutputStockPostInput } from '@/types/output-stock';
import { recordOutputStockMovement } from './output-stock';
import { runOperationInProcess } from './runner';
import { requireOrgScope } from '@/data-access/utils';

/** Browser stock edits use the same dependency contract as API corrections. */
export async function correctOutputStockEntry(ctx: OrgContext, raw: OutputStockPostInput) {
  requireOrgScope(ctx);
  const input = outputStockPostSchema.parse(raw);
  if (input.kind !== 'loss' || !input.correctsMovementId) throw new SafeError('Choose a Lost mass entry to edit.');
  return runOperationInProcess(recordOutputStockMovement, ctx, { ...input, checkFormEditLock: true });
}
