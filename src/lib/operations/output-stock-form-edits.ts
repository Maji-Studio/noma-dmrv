import type { OrgContext } from '@/lib/auth/server';
import { SafeError } from '@/lib/errors';
import { outputStockPostSchema } from '@/schemas/output-stock';
import type { OutputStockPostInput } from '@/types/output-stock';
import { recordOutputStockMovement } from './output-stock';
import { runOperationInProcess } from './runner';
import { requireOrgScope } from '@/data-access/utils';
import { removeOutputStockLossInTransaction, type RemovedOutputStockLoss } from '@/data-access/output-stock-loss-delete';
import { removeLossSchema } from '@/schemas/bin-movements';
import { withOutputStockErrors } from '@/lib/output-stock-domain-errors';
import { describeRecordedMovement } from './output-stock';
import type { Operation } from './runner';

/** Browser stock edits use the same dependency contract as API corrections. */
export async function correctOutputStockEntry(ctx: OrgContext, raw: OutputStockPostInput) {
  requireOrgScope(ctx);
  const input = outputStockPostSchema.parse(raw);
  if (input.kind !== 'loss' || !input.correctsMovementId) throw new SafeError('Choose a Lost mass entry to edit.');
  return runOperationInProcess(recordOutputStockMovement, ctx, { ...input, checkFormEditLock: true });
}

/** App-only: delete a Lost mass entry by recording its exact inverse. */
export const deleteOutputStockLoss: Operation<typeof removeLossSchema, RemovedOutputStockLoss> = {
  id: 'delete_output_stock_loss',
  input: removeLossSchema,
  supportsDryRun: false,
  describe: (input, output) => describeRecordedMovement(input, output.movementId),
  execute: ({ ctx, tx, activity }, input) => withOutputStockErrors(() =>
    removeOutputStockLossInTransaction(ctx, tx, input, { capture: activity.capture, onReplay: activity.skip, link: activity.link })),
};
