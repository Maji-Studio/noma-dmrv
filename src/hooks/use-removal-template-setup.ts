import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { applyRemovalTemplateSetup, loadRemovalTemplateSetup } from "@/fn/certification/removal-template-setup";
import type { ApplyRemovalTemplateSetupInput } from "@/schemas/removal-template-setup";
import { certificationKeys } from "./use-certification";
import { creditBatchKeys } from "./credit-batch-query-keys";
import { activityKeys } from "./activity-query-keys";
import { invalidateOnboardingProgress } from "./use-onboarding";
import { throwActionError } from "@/lib/stale-version";
import { unwrap } from "./types";

export function useRemovalTemplateSetup(facilityId: string, enabled = true) {
  return useQuery({ queryKey: certificationKeys.removalTemplateSetup(facilityId),
    queryFn: async () => unwrap(await loadRemovalTemplateSetup(facilityId)), enabled: enabled && !!facilityId, staleTime: 0 });
}

export function useApplyRemovalTemplateSetup() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: ApplyRemovalTemplateSetupInput) => {
      const result = await applyRemovalTemplateSetup(input);
      if (!result.success) throwActionError(result);
      return result.data;
    },
    onSuccess: async (_data, input) => {
      invalidateOnboardingProgress(client, input.facilityId);
      await Promise.all([
        client.invalidateQueries({ queryKey: certificationKeys.all }),
        client.invalidateQueries({ queryKey: creditBatchKeys.all }),
        client.invalidateQueries({ queryKey: activityKeys.all }),
      ]);
    },
  });
}
