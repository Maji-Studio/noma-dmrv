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
import { formatUtcDate } from "@/lib/date-utils";

const productionProcessKeys = {
  all: ["production-processes"] as const,
  eligibility: (facilityId?: string, feedstockTypeId?: string, batchStartDate?: string) =>
    ["production-processes", "eligibility", facilityId, feedstockTypeId, batchStartDate] as const,
};

export function useMethodBEligibility(
  facilityId?: string,
  feedstockTypeId?: string,
  enabled = true,
  batchStartDate?: Date,
) {
  const batchStartDay = batchStartDate ? formatUtcDate(batchStartDate) : undefined;
  return useQuery({
    queryKey: productionProcessKeys.eligibility(facilityId, feedstockTypeId, batchStartDay),
    queryFn: async () =>
      unwrap(
        await getMethodBEligibilityFn({
          facilityId,
          feedstockTypeId,
          batchStartDate: batchStartDay,
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
