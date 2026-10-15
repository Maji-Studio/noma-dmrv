'use server';

import { getMatchingOutputBins, getOutputStockHistory, previewOutputStock } from '@/data-access/output-stock-operations';
import { getOutputSubBins } from '@/data-access/output-sub-bins';
import { matchingOutputBinsSchema, outputStockFormPostSchema, outputStockPreviewSchema, outputSubBinsSchema } from '@/schemas/output-stock';
import type { OutputStockPostInput, OutputStockPreviewInput, OutputSubBinsInput } from '@/types/output-stock';
import { recordOutputStockMovement } from '@/lib/operations/output-stock';
import { runOperationInProcess } from '@/lib/operations/runner';
import { z } from 'zod';
import { correctOutputStockEntry } from '@/lib/operations/output-stock-form-edits';
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
  return withAction(async ctx => {
    const data = outputStockFormPostSchema.parse(input);
    const result = { ...await (data.correctsMovementId
      ? correctOutputStockEntry(ctx, data)
      : runOperationInProcess(recordOutputStockMovement, ctx, data)) };
    // Posting metadata is internal to the operation's activity record.
    delete result.replayed;
    delete result.facilityId;
    return result;
  });
}
export async function getOutputSubBinsFn(input: OutputSubBinsInput) {
  return withAction(ctx => getOutputSubBins(ctx, outputSubBinsSchema.parse(input)));
}
