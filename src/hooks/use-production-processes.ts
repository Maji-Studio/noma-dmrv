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
import { unwrap } from "@/hooks/types";

const productionProcessKeys = {
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
    queryFn: async () =>
      unwrap(
        await getMethodBEligibilityFn({
          facilityId,
          feedstockTypeId,
        }),
      ),
    enabled: enabled && Boolean(facilityId && feedstockTypeId),
  });
}

export function useRecordMethodBPrerequisites() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: RecordMethodBPrerequisitesInput) =>
      unwrap(await recordMethodBPrerequisitesFn(input)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: productionProcessKeys.all }),
  });
}

export function useStartNewProductionProcess() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: StartNewProcessInput) =>
      unwrap(await startNewProductionProcessFn(input)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: productionProcessKeys.all }),
  });
}
