"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getMethodBEligibilityFn,
  recordMethodBPrerequisitesFn,
  startNewProductionProcessFn,
} from "@/fn/production-processes";
import type {
  RecordMethodBPrerequisitesInput,
  StartNewProcessInput,
} from "@/schemas/production-process";

export const productionProcessKeys = {
  all: ["production-processes"] as const,
  eligibility: (facilityId?: string, feedstockTypeId?: string) =>
    ["production-processes", "eligibility", facilityId, feedstockTypeId] as const,
};

export function useMethodBEligibility(
  facilityId?: string,
  feedstockTypeId?: string,
  enabled = true,
) {
  return useQuery({
    queryKey: productionProcessKeys.eligibility(facilityId, feedstockTypeId),
    queryFn: async () => {
      const result = await getMethodBEligibilityFn({
        facilityId,
        feedstockTypeId,
      });
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: enabled && Boolean(facilityId && feedstockTypeId),
  });
}

export function useRecordMethodBPrerequisites() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: RecordMethodBPrerequisitesInput) => {
      const result = await recordMethodBPrerequisitesFn(input);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: productionProcessKeys.all }),
  });
}

export function useStartNewProductionProcess() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: StartNewProcessInput) => {
      const result = await startNewProductionProcessFn(input);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: productionProcessKeys.all }),
  });
}
