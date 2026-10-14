"use client";
import { throwActionError } from "@/lib/stale-version";
import { patchListCachesWithSavedRow } from "./list-cache-utils";

import { getMatchingOutputBinsFn, getOutputStockHistoryFn, getOutputSubBinsFn, postOutputStockFn, previewOutputStockFn } from "@/fn/output-stock";
import type { OutputStockPostInput, OutputStockPreviewInput, OutputSubBinsInput } from "@/types/output-stock";
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
import { unwrap } from "@/hooks/types";

export const outputStockKeys = {
  all: ["outputStock"] as const,
  preview: (input: OutputStockPreviewInput | null) => ["outputStock", "preview", input] as const,
  balance: (storageLocationId: string, facilityId: string, occurredAt?: string) => ["outputStock", "balance", storageLocationId, facilityId, occurredAt ?? "now"] as const,
  history: (id: string) => ["outputStock", "history", id] as const,
  subBins: (input: OutputSubBinsInput | null) => ["outputStock", "subBins", input] as const,
  matching: (facilityId: string, formulationId: string) => ["outputStock", "matching", facilityId, formulationId] as const,
};

export function useOutputStockPreview(input: OutputStockPreviewInput | null) {
  return useQuery({
    queryKey: outputStockKeys.preview(input),
    enabled: input !== null,
    queryFn: async () => {
      if (!input) throw new Error("Choose a storage bin first.");
      return unwrap(await previewOutputStockFn(input));
    },
    staleTime: 0,
    retry: false,
  });
}

/**
 * A bin's stock as of each fetch, or at `occurredAt` when an entry names its
 * time. Without one the instant is taken when the query runs, not when the
 * component renders, so the key stays stable and a refetch after a new entry
 * includes it.
 */
export function useOutputStockBalance(bin: { storageLocationId: string; facilityId: string } | null, occurredAt?: string) {
  return useQuery({
    queryKey: outputStockKeys.balance(bin?.storageLocationId ?? "", bin?.facilityId ?? "", occurredAt),
    enabled: bin !== null,
    queryFn: async () => {
      if (!bin) throw new Error("Choose a storage bin first.");
      return unwrap(await previewOutputStockFn({ ...bin, occurredAt: occurredAt ?? new Date().toISOString(), kind: "count", wetMassKg: 0, moisturePercent: null }));
    },
    staleTime: 0,
    retry: false,
  });
}

/**
 * A split bin's sub-bins at the entry's time, oldest first. Without
 * `occurredAt` they are read as of each fetch, like the bin balance: the
 * server takes that instant, so a batch placed just before is never left out. Keeps the last
 * answer for the same bin while the time is edited, so the reading rows do
 * not blink; another bin never shows the last bin's sub-bins.
 */
export function useOutputSubBins(input: OutputSubBinsInput | null) {
  return useQuery({
    queryKey: outputStockKeys.subBins(input),
    enabled: input !== null,
    queryFn: async () => {
      if (!input) throw new Error("Choose a storage bin first.");
      return unwrap(await getOutputSubBinsFn(input));
    },
    placeholderData: (previous, previousQuery) => previousQuery?.queryKey[2]?.storageLocationId === input?.storageLocationId ? previous : undefined,
    retry: false,
  });
}

export function useMatchingOutputBins(facilityId: string, formulationId: string, enabled = true) {
  return useQuery({
    queryKey: outputStockKeys.matching(facilityId, formulationId),
    enabled: enabled && !!facilityId && !!formulationId,
    queryFn: async () => unwrap(await getMatchingOutputBinsFn({ facilityId, formulationId })),
  });
}

export function useOutputStockHistory(storageLocationId: string, enabled = true) {
  return useQuery({
    queryKey: outputStockKeys.history(storageLocationId),
    enabled: enabled && !!storageLocationId,
    queryFn: async () => unwrap(await getOutputStockHistoryFn(storageLocationId)),
  });
}

export function usePostOutputStock() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: OutputStockPostInput) => {
      const result = await postOutputStockFn(input);
      if (!result.success) throwActionError(result);
      return result.data;
    },
    onSuccess: (data) => {
      for (const row of data.savedDeliveries) {
        patchListCachesWithSavedRow(client, deliveryKeys.lists(), row);
        client.setQueriesData({ queryKey: deliveryKeys.detail(row.id) }, (old: object | undefined) => old ? { ...old, ...row } : old);
      }
      for (const row of data.savedProducts) {
        patchListCachesWithSavedRow(client, biocharProductKeys.lists(), row);
        client.setQueryData(biocharProductKeys.detail(row.id), (old: object | undefined) => old ? { ...old, ...row } : old);
      }
      for (const key of [outputStockKeys.all, storageLocationKeys.all, biocharProductKeys.all, deliveryKeys.all, orderKeys.all, dashboardOverviewKeys.all, certificationKeys.all, creditBatchKeys.all, chainOfCustodyKeys.all]) {
        void client.invalidateQueries({ queryKey: key });
      }
      invalidateStockEntityQueries(client, "delivery");
    },
    onError: () => { void client.invalidateQueries({ queryKey: outputStockKeys.all }); },
  });
}
