import { returnActivitySnapshot } from '@/lib/production-run-returns/activity';
import { toReturnMovement, type ReturnMovement } from '@/lib/production-run-returns/movement';
import type { BinMovement } from '@/db/schema';
import { recordProductionRunReturnInTransaction, correctProductionRunReturnInTransaction } from '@/data-access/production-run-returns';
import { readReturnSource } from '@/data-access/production-run-returns/queries';
import { recordProductionRunReturnSchema, correctProductionRunReturnSchema } from '@/schemas/production-run-returns';
import type { ReturnWriteOptions } from '@/data-access/production-run-returns/writer';
import type { Operation, OperationScope } from './runner';

/** Only the writer can distinguish a new posting from a persistent-key replay. */
async function captureReturn(scope: OperationScope, write: (options: ReturnWriteOptions) => Promise<BinMovement>) {
  let captured = false;
  const result = await write({ capture: (sourceRunId, before, after) => {
    captured = true;
    scope.activity.capture(sourceRunId, before ? returnActivitySnapshot(before, 'returned') : null,
      'reversal' in after
        ? { ...returnActivitySnapshot(before, 'returned'), ...returnActivitySnapshot(after.reversal, 'reversed'),
          ...returnActivitySnapshot(after.replacement, 'replacement') }
        : returnActivitySnapshot(after, 'returned'));
  } });
  if (!captured) scope.activity.skip();
  else {
    const { run } = await readReturnSource(scope.ctx, scope.tx, result.sourceProductionRunId!);
    scope.activity.link({ facilityId: run.facilityId, productionRunId: run.id });
  }
  return toReturnMovement(result);
}

export const recordProductionRunReturn: Operation<typeof recordProductionRunReturnSchema, ReturnMovement> = {
  id: 'record_production_run_return',
  input: recordProductionRunReturnSchema,
  supportsDryRun: false,
  describe: input => ({ outcome: 'updated', entityType: 'productionRun', entityIds: [input.sourceProductionRunId], versionBefore: null, versionAfter: null }),
  execute: (scope, input) => captureReturn(scope, options => recordProductionRunReturnInTransaction(scope.ctx, scope.tx, input, options)),
};

export const correctProductionRunReturn: Operation<typeof correctProductionRunReturnSchema, ReturnMovement> = {
  id: 'correct_production_run_return',
  input: correctProductionRunReturnSchema,
  supportsDryRun: false,
  describe: input => ({ outcome: 'updated', entityType: 'productionRun', entityIds: [input.sourceProductionRunId], versionBefore: null, versionAfter: null }),
  execute: (scope, input) => captureReturn(scope, options => correctProductionRunReturnInTransaction(scope.ctx, scope.tx, input, options)),
};
