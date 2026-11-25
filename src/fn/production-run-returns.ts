"use server";

import { z } from 'zod';
import { toReturnMovement, type ReturnMovement } from '@/lib/production-run-returns/movement';
import type { ActionResult } from '@/types/actions';
import { getProductionRunReturnHistory, getProductionRunReturnAllowance } from '@/data-access/production-run-returns';
import { getProductionRunReturnEligibility, type ProductionRunReturnEligibility } from '@/data-access/production-run-returns/eligibility';
import { recordProductionRunReturn, correctProductionRunReturn } from '@/lib/operations/production-run-returns';
import { runOperationInProcess } from '@/lib/operations/runner';
import { recordProductionRunReturnSchema, correctProductionRunReturnSchema, type RecordProductionRunReturnInput, type CorrectProductionRunReturnInput } from '@/schemas/production-run-returns';
import { getProductionRunMaterialBalance } from '@/data-access/production-run-material-balance';
import { withAction } from './with-action';

export async function recordProductionRunReturnFn(input: RecordProductionRunReturnInput): Promise<ActionResult<ReturnMovement>> {
  return withAction(ctx => runOperationInProcess(recordProductionRunReturn, ctx, recordProductionRunReturnSchema.parse(input)), {
    fallbackMessage: 'Failed to record return',
  });
}

export async function correctProductionRunReturnFn(input: CorrectProductionRunReturnInput): Promise<ActionResult<ReturnMovement>> {
  return withAction(ctx => runOperationInProcess(correctProductionRunReturn, ctx, correctProductionRunReturnSchema.parse(input)), {
    fallbackMessage: 'Failed to correct return',
  });
}

export async function getProductionRunReturnHistoryFn(sourceProductionRunId: string): Promise<ActionResult<ReturnMovement[]>> {
  return withAction(async ctx => (await getProductionRunReturnHistory(ctx, z.uuid().parse(sourceProductionRunId))).map(toReturnMovement), {
    fallbackMessage: 'Failed to load return history',
  });
}

export async function getProductionRunReturnEligibilityFn(sourceProductionRunId: string): Promise<ActionResult<ProductionRunReturnEligibility>> {
  return withAction(ctx => getProductionRunReturnEligibility(ctx, z.uuid().parse(sourceProductionRunId)), {
    fallbackMessage: 'Failed to check return eligibility',
  });
}

export async function getProductionRunReturnAllowanceFn(sourceProductionRunId: string): Promise<ActionResult<{ consumedDryKg: number; remainingDryKg: number; returnedFeedstockTypeId: string }>> {
  return withAction(async ctx => {
    const { consumedDryKg, remainingDryKg, returnedFeedstockTypeId } = await getProductionRunReturnAllowance(ctx, z.uuid().parse(sourceProductionRunId));
    return { consumedDryKg, remainingDryKg, returnedFeedstockTypeId };
  }, { fallbackMessage: 'Failed to load return allowance' });
}

export async function getProductionRunMaterialBalanceFn(sourceProductionRunId: string): Promise<ActionResult<Awaited<ReturnType<typeof getProductionRunMaterialBalance>>>> {
  return withAction(ctx => getProductionRunMaterialBalance(ctx, z.uuid().parse(sourceProductionRunId)), {
    fallbackMessage: 'Failed to load run material balance',
  });
}
