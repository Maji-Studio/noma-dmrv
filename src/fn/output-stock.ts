'use server';

import { getMatchingOutputBins, getOutputStockHistory, previewOutputStock } from '@/data-access/output-stock-operations';
import { getLinkedOutputBinInventory, getOutputSubBins } from '@/data-access/output-sub-bins';
import { matchingOutputBinsSchema, outputStockFormPostSchema, outputStockPreviewSchema, outputSubBinsSchema } from '@/schemas/output-stock';
import type { LinkedOutputBinInventoryInput, OutputStockPostInput, OutputStockPreviewInput, OutputSubBinsInput } from '@/types/output-stock';
import { recordOutputStockMovement } from '@/lib/operations/output-stock';
import { runOperationInProcess } from '@/lib/operations/runner';
import { z } from 'zod';
import { correctOutputStockEntry, deleteOutputStockLoss } from '@/lib/operations/output-stock-form-edits';
import { removeLossSchema, type RemoveLossData } from '@/schemas/bin-movements';
import { withAction } from './with-action';

export async function previewOutputStockFn(input: OutputStockPreviewInput) {
  return withAction(ctx => previewOutputStock(ctx, outputStockPreviewSchema.parse(input)));
}
export async function getOutputStockHistoryFn(storageLocationId: string) {
  return withAction(ctx => getOutputStockHistory(ctx, z.uuid().parse(storageLocationId)));
}
export async function getMatchingOutputBinsFn(input: { facilityId: string; formulationId: string }) {
  return withAction(ctx => getMatchingOutputBins(ctx, matchingOutputBinsSchema.parse(input)));
}
/** New losses and counts share the API operation; only Lost mass has a stock form edit. */
export async function postOutputStockFn(input: OutputStockPostInput) {
  return withAction(ctx => {
    const data = outputStockFormPostSchema.parse(input);
    return data.correctsMovementId
      ? correctOutputStockEntry(ctx, data)
      : runOperationInProcess(recordOutputStockMovement, ctx, data);
  });
}
export async function getOutputSubBinsFn(input: OutputSubBinsInput) {
  return withAction(ctx => getOutputSubBins(ctx, outputSubBinsSchema.parse(input)));
}

export async function removeOutputLossFn(data: RemoveLossData) {
  return withAction(ctx => runOperationInProcess(deleteOutputStockLoss, ctx, removeLossSchema.parse(data)), {
    fallbackMessage: 'Failed to remove Lost mass',
    log: { message: 'Failed to remove Lost mass', context: { op: 'output-stock:remove-loss' } },
  });
}

export async function getLinkedOutputBinInventoryFn(input: LinkedOutputBinInventoryInput) {
  return withAction(ctx => getLinkedOutputBinInventory(ctx,
    outputSubBinsSchema.pick({ storageLocationId: true, facilityId: true, occurredAt: true }).parse(input)));
}
