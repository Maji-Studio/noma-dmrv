'use client';

import { previewProductStockFn } from '@/fn/product-stock-preview';
import { outputStockKeys } from './use-output-stock';
import { useQuery } from '@tanstack/react-query';

export const productStockPreviewKeys = {
  all: [...outputStockKeys.all, 'productPreview'] as const,
  preview: (input: Parameters<typeof previewProductStockFn>[0] | null) => [...productStockPreviewKeys.all, input] as const,
};

export function useProductStockPreview(input: Parameters<typeof previewProductStockFn>[0] | null) {
  return useQuery({ queryKey: productStockPreviewKeys.preview(input), enabled: input !== null, staleTime: 0, retry: false,
    queryFn: async () => {
      if (!input) throw new Error('Complete product measurements to preview stock.');
      const result = await previewProductStockFn(input);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
  });
}
