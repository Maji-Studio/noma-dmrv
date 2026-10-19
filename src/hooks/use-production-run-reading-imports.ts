"use client";

// Retained non-MVP seam (#942 q25, #1014): no current consumer; retained for structured readings imports. See docs/architecture.md#production-run-extensions.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  importProductionRunReadingsFromDocumentFn,
  type ProductionRunReadingsImportResult,
} from "@/fn/production-run-reading-imports";
import { productionRunKeys } from "@/hooks/use-production-runs";
import { productionRunReadingKeys } from "@/hooks/use-production-run-readings";
import { invalidateCertificationReadiness } from "@/hooks/use-certification";
import { unwrap } from "@/hooks/types";

export function useImportProductionRunReadings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      documentId: string,
    ): Promise<ProductionRunReadingsImportResult> =>
      unwrap(
        await importProductionRunReadingsFromDocumentFn({
          documentId,
        }),
      ),
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
      invalidateCertificationReadiness(queryClient);
    },
  });
}
