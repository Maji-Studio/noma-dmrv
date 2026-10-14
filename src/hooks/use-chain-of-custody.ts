/**
 * Chain of Custody React Query Hook
 */

import { useQuery } from "@tanstack/react-query";
import {
  getApplicationTrailFn,
  getChainOfCustodyFn,
  getChainOfCustodyGeoFn,
  getCreditBatchChainFn,
  getCreditBatchChainGeoFn,
} from "@/fn/chain-of-custody";
import { unwrap } from "@/hooks/types";

const STALE_TIME_MS = 30_000;

export const chainOfCustodyKeys = {
  all: ["chain-of-custody"] as const,
  detail: (applicationId: string) =>
    [...chainOfCustodyKeys.all, applicationId] as const,
  geo: (applicationId: string) =>
    [...chainOfCustodyKeys.all, "geo", applicationId] as const,
  trail: (applicationId: string) =>
    [...chainOfCustodyKeys.all, "trail", applicationId] as const,
  batch: (creditBatchId: string) =>
    [...chainOfCustodyKeys.all, "batch", creditBatchId] as const,
  batchGeo: (creditBatchId: string, productionRunId: string | null = null) =>
    [
      ...chainOfCustodyKeys.all,
      "batch-geo",
      creditBatchId,
      productionRunId,
    ] as const,
};

export function useChainOfCustody(applicationId: string | null) {
  return useQuery({
    queryKey: chainOfCustodyKeys.detail(applicationId ?? ""),
    queryFn: async () => unwrap(await getChainOfCustodyFn(applicationId!)),
    enabled: !!applicationId,
    staleTime: STALE_TIME_MS,
  });
}

export function useChainOfCustodyGeo(applicationId: string | null) {
  return useQuery({
    queryKey: chainOfCustodyKeys.geo(applicationId ?? ""),
    queryFn: async () => unwrap(await getChainOfCustodyGeoFn(applicationId!)),
    enabled: !!applicationId,
    staleTime: STALE_TIME_MS,
  });
}

export function useApplicationTrail(applicationId: string | null) {
  return useQuery({
    queryKey: chainOfCustodyKeys.trail(applicationId ?? ""),
    queryFn: async () => unwrap(await getApplicationTrailFn(applicationId!)),
    enabled: !!applicationId,
    staleTime: STALE_TIME_MS,
  });
}

export function useCreditBatchChain(creditBatchId: string | null) {
  return useQuery({
    queryKey: chainOfCustodyKeys.batch(creditBatchId ?? ""),
    queryFn: async () => unwrap(await getCreditBatchChainFn(creditBatchId!)),
    enabled: !!creditBatchId,
    staleTime: STALE_TIME_MS,
  });
}

export function useCreditBatchChainGeo(
  creditBatchId: string | null,
  productionRunId: string | null = null
) {
  return useQuery({
    queryKey: chainOfCustodyKeys.batchGeo(creditBatchId ?? "", productionRunId),
    queryFn: async () =>
      unwrap(
        await getCreditBatchChainGeoFn(
          creditBatchId!,
          productionRunId
        ),
      ),
    enabled: !!creditBatchId,
    staleTime: STALE_TIME_MS,
  });
}
