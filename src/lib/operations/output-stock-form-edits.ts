import type { OrgContext } from '@/lib/auth/server';
import { SafeError } from '@/lib/errors';
import { outputStockPostSchema } from '@/schemas/output-stock';
import type { OutputStockPostInput } from '@/types/output-stock';
import { recordOutputStockMovement } from './output-stock';
import { runOperationInProcess } from './runner';
import { requireOrgScope } from '@/data-access/utils';

/** Browser stock edits require the latest entry; API corrections keep their dependency contract. */
export async function correctOutputStockEntry(ctx: OrgContext, raw: OutputStockPostInput) {
  requireOrgScope(ctx);
  const input = outputStockPostSchema.parse(raw);
  if (input.kind !== 'loss' || !input.correctsMovementId) throw new SafeError('Choose a Lost mass entry to edit.');
  return runOperationInProcess(recordOutputStockMovement, ctx, { ...input, requireLatestCorrection: true });
}
