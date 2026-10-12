'use server';

import { getMatchingOutputBins, getOutputStockHistory, previewOutputStock } from '@/data-access/output-stock-operations';
import { getOutputSubBins } from '@/data-access/output-sub-bins';
import { matchingOutputBinsSchema, outputStockPostSchema, outputStockPreviewSchema, outputSubBinsSchema } from '@/schemas/output-stock';
import type { OutputStockPostInput, OutputStockPreviewInput, OutputSubBinsInput } from '@/types/output-stock';
import { recordOutputStockMovement } from '@/lib/operations/output-stock';
import { runOperationInProcess } from '@/lib/operations/runner';
import { z } from 'zod';
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
/** Losses, counts and corrections run through the same operation as the API. */
export async function postOutputStockFn(input: OutputStockPostInput) {
  return withAction(ctx => runOperationInProcess(recordOutputStockMovement, ctx, outputStockPostSchema.parse(input)));
}
export async function getOutputSubBinsFn(input: OutputSubBinsInput) {
  return withAction(ctx => getOutputSubBins(ctx, outputSubBinsSchema.parse(input)));
}
