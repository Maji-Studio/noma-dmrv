"use client";

import { getMatchingOutputBinsFn, getOutputStockHistoryFn, postOutputStockFn, previewOutputStockFn } from "@/fn/output-stock";
import type { OutputStockPostInput, OutputStockPreviewInput } from "@/types/output-stock";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { creditBatchKeys } from "./credit-batch-query-keys";
import { invalidateStockEntityQueries } from "./entity-query-keys";
import { biocharProductKeys } from "./use-biochar-products";
import { orderKeys } from "./use-orders";
import { chainOfCustodyKeys } from "./use-chain-of-custody";
import { deliveryKeys } from "./use-deliveries";
import { storageLocationKeys } from "./use-storage-locations";
import { certificationKeys } from "./use-certification";
import { dashboardOverviewKeys } from "./use-dashboard-overview";

export const outputStockKeys = {
  all: ["outputStock"] as const,
  preview: (input: OutputStockPreviewInput | null) => ["outputStock", "preview", input] as const,
  history: (id: string) => ["outputStock", "history", id] as const,
  matching: (facilityId: string, formulationId: string) => ["outputStock", "matching", facilityId, formulationId] as const,
};

export function useOutputStockPreview(input: OutputStockPreviewInput | null) {
  return useQuery({
    queryKey: outputStockKeys.preview(input),
    enabled: input !== null,
    queryFn: async () => {
      if (!input) throw new Error("Choose a storage bin first.");
      const result = await previewOutputStockFn(input);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    staleTime: 0,
    retry: false,
  });
}

export function useMatchingOutputBins(facilityId: string, formulationId: string) {
  return useQuery({
    queryKey: outputStockKeys.matching(facilityId, formulationId),
    enabled: !!facilityId && !!formulationId,
    queryFn: async () => {
      const result = await getMatchingOutputBinsFn({ facilityId, formulationId });
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
  });
}

export function useOutputStockHistory(storageLocationId: string, enabled = true) {
  return useQuery({
    queryKey: outputStockKeys.history(storageLocationId),
    enabled: enabled && !!storageLocationId,
    queryFn: async () => {
      const result = await getOutputStockHistoryFn(storageLocationId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
  });
}

export function usePostOutputStock() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: OutputStockPostInput) => {
      const result = await postOutputStockFn(input);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: () => {
      for (const key of [outputStockKeys.all, storageLocationKeys.all, biocharProductKeys.all, deliveryKeys.all, orderKeys.all, dashboardOverviewKeys.all, certificationKeys.all, creditBatchKeys.all, chainOfCustodyKeys.all]) {
        void client.invalidateQueries({ queryKey: key });
      }
      invalidateStockEntityQueries(client, "delivery");
    },
    onError: () => { void client.invalidateQueries({ queryKey: outputStockKeys.all }); },
  });
}
