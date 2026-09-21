'use server';

import { previewProductStock, type ProductStockPreviewInput } from '@/data-access/product-stock-preview';
import { biocharProductFormSchema } from '@/schemas/biochar-products';
import { withAction } from './with-action';

const previewSchema = biocharProductFormSchema.pick({ facilityId: true, formulationId: true, placedAt: true, sourceBiocharStorageLocationId: true, storageLocationId: true, massKg: true, moistureContentPercent: true, waterAddedKg: true, ingredientBins: true });

export async function previewProductStockFn(input: ProductStockPreviewInput) {
  return withAction(ctx => previewProductStock(ctx, previewSchema.parse(input)));
}
