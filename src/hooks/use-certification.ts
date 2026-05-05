/**
 * Certification React Query hooks
 * Manages the facility ↔ Isometric project mapping.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteFacilityCertifierMapping,
  loadCertifyContextForCreditBatch,
  loadCreditBatchSubmissionState,
  loadFacilityCertifierMapping,
  loadIsometricProjectTemplates,
  saveFacilityCertifierMapping,
  submitCreditBatch,
} from "@/fn/certification";
import type { SaveMappingInput } from "@/schemas/certification";

export const certificationKeys = {
  all: ["certification"] as const,
  facilityMapping: (facilityId: string) =>
    [...certificationKeys.all, "facility-mapping", facilityId] as const,
  projectTemplates: (externalProjectId: string) =>
    [...certificationKeys.all, "project-templates", externalProjectId] as const,
  certifyContextForCreditBatch: (creditBatchId: string) =>
    [
      ...certificationKeys.all,
      "certify-context",
      "credit-batch",
      creditBatchId,
    ] as const,
  submissionStateForCreditBatch: (creditBatchId: string) =>
    [
      ...certificationKeys.all,
      "submission-state",
      "credit-batch",
      creditBatchId,
    ] as const,
};

export function useFacilityCertifierMapping(
  facilityId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: certificationKeys.facilityMapping(facilityId),
    queryFn: async () => {
      const result = await loadFacilityCertifierMapping(facilityId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: enabled && !!facilityId,
    staleTime: 30_000,
  });
}

export function useIsometricProjectTemplates(externalProjectId: string | null) {
  return useQuery({
    queryKey: externalProjectId
      ? certificationKeys.projectTemplates(externalProjectId)
      : ["certification", "project-templates", "none"],
    queryFn: async () => {
      if (!externalProjectId) return [];
      const result = await loadIsometricProjectTemplates(externalProjectId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!externalProjectId,
    staleTime: 60_000,
  });
}

export function useSaveFacilityCertifierMapping() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SaveMappingInput) => {
      const result = await saveFacilityCertifierMapping(input);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: certificationKeys.facilityMapping(variables.facilityId),
      });
      queryClient.invalidateQueries({ queryKey: certificationKeys.all });
    },
  });
}

export function useCertifyContextForCreditBatch(
  creditBatchId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: certificationKeys.certifyContextForCreditBatch(creditBatchId),
    queryFn: async () => {
      const result = await loadCertifyContextForCreditBatch(creditBatchId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: enabled && !!creditBatchId,
    staleTime: 5 * 60_000,
  });
}

export function useCreditBatchSubmissionState(
  creditBatchId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: certificationKeys.submissionStateForCreditBatch(creditBatchId),
    queryFn: async () => {
      const result = await loadCreditBatchSubmissionState(creditBatchId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: enabled && !!creditBatchId,
    staleTime: 30_000,
    refetchInterval: (query) =>
      query.state.data?.isLockedInFlight ? 60_000 : false,
  });
}

export function useSubmitCreditBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (creditBatchId: string) => {
      const result = await submitCreditBatch(creditBatchId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (_data, creditBatchId) => {
      queryClient.invalidateQueries({
        queryKey:
          certificationKeys.submissionStateForCreditBatch(creditBatchId),
      });
      queryClient.invalidateQueries({
        queryKey: certificationKeys.certifyContextForCreditBatch(creditBatchId),
      });
    },
  });
}

export function useDeleteFacilityCertifierMapping() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (facilityId: string) => {
      const result = await deleteFacilityCertifierMapping(facilityId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (_data, facilityId) => {
      queryClient.invalidateQueries({
        queryKey: certificationKeys.facilityMapping(facilityId),
      });
      queryClient.invalidateQueries({ queryKey: certificationKeys.all });
    },
  });
}
