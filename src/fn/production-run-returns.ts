"use server";

import { z } from 'zod';
import { type ReturnMovement } from '@/lib/production-run-returns/movement';
import type { ActionResult } from '@/types/actions';
import { getProductionRunReturnEligibility, type ProductionRunReturnEligibility } from '@/data-access/production-run-returns/eligibility';
import { recordProductionRunReturn, correctProductionRunReturn } from '@/lib/operations/production-run-returns';
import { runOperationInProcess } from '@/lib/operations/runner';
import { recordProductionRunReturnSchema, correctProductionRunReturnSchema, type RecordProductionRunReturnInput, type CorrectProductionRunReturnInput } from '@/schemas/production-run-returns';
import { getProductionRunReturnRows, type ProductionRunReturnRow } from '@/data-access/production-run-returns/view';
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

export async function getProductionRunReturnEligibilityFn(sourceProductionRunId: string): Promise<ActionResult<ProductionRunReturnEligibility>> {
  return withAction(ctx => getProductionRunReturnEligibility(ctx, z.uuid().parse(sourceProductionRunId)), {
    fallbackMessage: 'Failed to check return eligibility',
  });
}

export async function getProductionRunMaterialBalanceFn(sourceProductionRunId: string): Promise<ActionResult<Awaited<ReturnType<typeof getProductionRunMaterialBalance>>>> {
  return withAction(ctx => getProductionRunMaterialBalance(ctx, z.uuid().parse(sourceProductionRunId)), {
    fallbackMessage: 'Failed to load run material balance',
  });
}

export async function getProductionRunReturnRowsFn(sourceProductionRunId: string): Promise<ActionResult<ProductionRunReturnRow[]>> {
  return withAction(ctx => getProductionRunReturnRows(ctx, z.uuid().parse(sourceProductionRunId)), {
    fallbackMessage: 'Failed to load returns',
  });
}
