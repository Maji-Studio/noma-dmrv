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
  batchGeo: (creditBatchId: string) =>
    [...chainOfCustodyKeys.all, "batch-geo", creditBatchId] as const,
};

export function useChainOfCustody(applicationId: string | null) {
  return useQuery({
    queryKey: chainOfCustodyKeys.detail(applicationId ?? ""),
    queryFn: async () => {
      const result = await getChainOfCustodyFn(applicationId!);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    enabled: !!applicationId,
    staleTime: STALE_TIME_MS,
  });
}

export function useChainOfCustodyGeo(applicationId: string | null) {
  return useQuery({
    queryKey: chainOfCustodyKeys.geo(applicationId ?? ""),
    queryFn: async () => {
      const result = await getChainOfCustodyGeoFn(applicationId!);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    enabled: !!applicationId,
    staleTime: STALE_TIME_MS,
  });
}

export function useApplicationTrail(applicationId: string | null) {
  return useQuery({
    queryKey: chainOfCustodyKeys.trail(applicationId ?? ""),
    queryFn: async () => {
      const result = await getApplicationTrailFn(applicationId!);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    enabled: !!applicationId,
    staleTime: STALE_TIME_MS,
  });
}

export function useCreditBatchChain(creditBatchId: string | null) {
  return useQuery({
    queryKey: chainOfCustodyKeys.batch(creditBatchId ?? ""),
    queryFn: async () => {
      const result = await getCreditBatchChainFn(creditBatchId!);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    enabled: !!creditBatchId,
    staleTime: STALE_TIME_MS,
  });
}

export function useCreditBatchChainGeo(creditBatchId: string | null) {
  return useQuery({
    queryKey: chainOfCustodyKeys.batchGeo(creditBatchId ?? ""),
    queryFn: async () => {
      const result = await getCreditBatchChainGeoFn(creditBatchId!);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    enabled: !!creditBatchId,
    staleTime: STALE_TIME_MS,
  });
}
