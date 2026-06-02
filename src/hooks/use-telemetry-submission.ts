/**
 * React Query hooks for the Phase 5 Slice A telemetry pipeline
 * (ADR 0006). One query for the latest submission + remote status,
 * one mutation that runs the three-POST pipeline inside a single
 * server action.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  loadTelemetrySubmissionState,
  submitTelemetryAction,
  type SubmitTelemetryArgs,
} from "@/fn/certification";

const TELEMETRY_STALE_MS = 30_000;
const TELEMETRY_PENDING_REFETCH_MS = 5_000;

export const telemetryKeys = {
  all: ["telemetry"] as const,
  forRemoval: (removalId: string) =>
    [...telemetryKeys.all, "removal", removalId] as const,
};

export function useTelemetrySubmissionState(removalId: string) {
  return useQuery({
    queryKey: telemetryKeys.forRemoval(removalId),
    queryFn: async () => {
      const result = await loadTelemetrySubmissionState(removalId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!removalId,
    staleTime: TELEMETRY_STALE_MS,
    refetchInterval: (query) =>
      query.state.data?.latestStatus?.status === "pending"
        ? TELEMETRY_PENDING_REFETCH_MS
        : false,
  });
}

export function useSubmitTelemetry(removalId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: Omit<SubmitTelemetryArgs, "removalId">) => {
      const result = await submitTelemetryAction({ removalId, ...args });
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: telemetryKeys.forRemoval(removalId),
      });
    },
  });
}
