'use client';

import { previewProductStockFn } from '@/fn/product-stock-preview';
import { outputStockKeys } from './use-output-stock';
import { useQuery } from '@tanstack/react-query';
import { unwrap } from './types';

export const productStockPreviewKeys = {
  all: [...outputStockKeys.all, 'productPreview'] as const,
  preview: (input: Parameters<typeof previewProductStockFn>[0] | null) => [...productStockPreviewKeys.all, input] as const,
};

export function useProductStockPreview(input: Parameters<typeof previewProductStockFn>[0] | null) {
  return useQuery({ queryKey: productStockPreviewKeys.preview(input), enabled: input !== null, staleTime: 0, retry: false,
    queryFn: async () => {
      if (!input) throw new Error('Complete product measurements to preview stock.');
      return unwrap(await previewProductStockFn(input));
    },
  });
}
