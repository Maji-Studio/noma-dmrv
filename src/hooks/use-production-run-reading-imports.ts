"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  importProductionRunReadingsFromDocumentFn,
  type ProductionRunReadingsImportResult,
} from "@/fn/production-run-reading-imports";
import { productionRunKeys } from "@/hooks/use-production-runs";
import { productionRunReadingKeys } from "@/hooks/use-production-run-readings";

export function useImportProductionRunReadings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      documentId: string,
    ): Promise<ProductionRunReadingsImportResult> => {
      const result = await importProductionRunReadingsFromDocumentFn({
        documentId,
      });
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: productionRunKeys.lists(),
      });
      queryClient.invalidateQueries({
        queryKey: productionRunKeys.detail(data.productionRunId),
      });
      queryClient.invalidateQueries({
        queryKey: productionRunReadingKeys.lists(),
      });
      queryClient.invalidateQueries({
        queryKey: productionRunKeys.readings(data.productionRunId),
      });
    },
  });
}
