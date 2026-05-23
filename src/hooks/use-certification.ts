/**
 * Certification React Query hooks
 * Manages the facility ↔ Isometric project mapping and the Removal
 * submission flow (N credit batches → 1 Isometric Removal — ADR 0003).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  assignCreditBatchToRemovalAction,
  deleteFacilityCertifierMapping,
  ensureRemovalForCreditBatchAction,
  loadCertifyContextForCreditBatch,
  loadFacilityCertifierMapping,
  loadIsometricProjectTemplates,
  loadRemovalsForFacility,
  saveFacilityCertifierMapping,
  saveFacilityEmissionConfig,
  submitCreditBatchRemoval,
  submitRemovalAction,
} from "@/fn/certification";
import type {
  AssignCreditBatchToRemovalInput,
  FacilityEmissionConfigFormData,
  SaveMappingInput,
  SubmitCreditBatchInput,
  SubmitRemovalInput,
} from "@/schemas/certification";

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
  removalsForFacility: (facilityId: string) =>
    [...certificationKeys.all, "removals", facilityId] as const,
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

export function useSaveFacilityEmissionConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: FacilityEmissionConfigFormData) => {
      const result = await saveFacilityEmissionConfig(input);
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

// Removal-scoped Certify context for the credit-batch side-sheet panel.
// Refetches while a submission is locked in flight so the panel reflects
// progress without a manual refresh.
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
    staleTime: 30_000,
    refetchInterval: (query) =>
      query.state.data?.latestSubmission?.lockedAt ? 60_000 : false,
  });
}

// Removals hub listing for a facility — removals + members + status, plus
// the pool of credit batches not yet grouped into a removal.
export function useRemovalsForFacility(facilityId: string, enabled = true) {
  return useQuery({
    queryKey: certificationKeys.removalsForFacility(facilityId),
    queryFn: async () => {
      const result = await loadRemovalsForFacility(facilityId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: enabled && !!facilityId,
    staleTime: 30_000,
  });
}

// Panel submit — ensures the credit batch's removal (lazy 1:1), then submits.
export function useSubmitCreditBatchRemoval() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SubmitCreditBatchInput | string) => {
      const result = await submitCreditBatchRemoval(input);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: certificationKeys.all });
    },
  });
}

// Hub submit — submits an existing removal directly.
export function useSubmitRemoval() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SubmitRemovalInput | string) => {
      const result = await submitRemovalAction(input);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: certificationKeys.all });
    },
  });
}

// Starts a fresh removal for a credit batch (no submission).
export function useEnsureRemovalForCreditBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (creditBatchId: string) => {
      const result = await ensureRemovalForCreditBatchAction(creditBatchId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: certificationKeys.all });
    },
  });
}

// N:1 grouping — move a credit batch onto a removal, or detach with null.
export function useAssignCreditBatchToRemoval() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: AssignCreditBatchToRemovalInput) => {
      const result = await assignCreditBatchToRemovalAction(input);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: certificationKeys.all });
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
