/**
 * Certification React Query hooks
 * Manages the facility ↔ Isometric project mapping and the Removal
 * submission flow (N credit batches → 1 Isometric Removal — ADR 0003).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  assignCreditBatchToRemovalAction,
  createGhgStatementDraft,
  deleteFacilityCertifierMapping,
  ensureRemovalForCreditBatchAction,
  loadCertifyContextForCreditBatch,
  loadFacilityCertifierMapping,
  loadGhgStatementsForFacility,
  loadGhgStatementState,
  loadIsometricProjectTemplates,
  loadOpenRemovalsForFacility,
  loadRemovalsForFacility,
  refreshGhgStatementStatus,
  saveFacilityCertifierMapping,
  saveFacilityEmissionConfig,
  submitCreditBatchRemoval,
  submitGhgStatementToVerifier,
  submitRemovalAction,
} from "@/fn/certification";
import type {
  AssignCreditBatchToRemovalInput,
  CreateGhgStatementInput,
  FacilityEmissionConfigFormData,
  SaveMappingInput,
  SubmitCreditBatchInput,
  SubmitGhgStatementDialogInput,
  SubmitRemovalInput,
} from "@/schemas/certification";

// Stale-time policy for certification queries. `LOCKED_REFETCH_INTERVAL_MS`
// drives the in-flight polling cadence in `useCertifyContextForCreditBatch`
// and `useGhgStatementState`; the project-templates list is read rarely so
// it gets its own longer stale window.
const DEFAULT_STALE_MS = 30_000;
const PROJECT_TEMPLATES_STALE_MS = 60_000;
const LOCKED_REFETCH_INTERVAL_MS = 60_000;

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
  ghgStatementsForFacility: (facilityId: string) =>
    [...certificationKeys.all, "ghg-statements", facilityId] as const,
  ghgStatementState: (ghgStatementId: string) =>
    [...certificationKeys.all, "ghg-statement", ghgStatementId] as const,
  openRemovalsForFacility: (facilityId: string) =>
    [...certificationKeys.all, "open-removals", facilityId] as const,
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
    staleTime: DEFAULT_STALE_MS,
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
    staleTime: PROJECT_TEMPLATES_STALE_MS,
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
    staleTime: DEFAULT_STALE_MS,
    refetchInterval: (query) =>
      query.state.data?.latestSubmission?.lockedAt
        ? LOCKED_REFETCH_INTERVAL_MS
        : false,
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
    staleTime: DEFAULT_STALE_MS,
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

// =====================================================================
// GHG Statements (ADR 0003 / Phase 4.5)
// =====================================================================

// Hub listing — every GHG statement for a facility with status + counts.
export function useGhgStatementsForFacility(
  facilityId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: certificationKeys.ghgStatementsForFacility(facilityId),
    queryFn: async () => {
      const result = await loadGhgStatementsForFacility(facilityId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: enabled && !!facilityId,
    staleTime: DEFAULT_STALE_MS,
  });
}

// One statement's detail state. Refetches while a submission is locked in
// flight so the panel reflects progress without a manual refresh.
export function useGhgStatementState(ghgStatementId: string, enabled = true) {
  return useQuery({
    queryKey: certificationKeys.ghgStatementState(ghgStatementId),
    queryFn: async () => {
      const result = await loadGhgStatementState(ghgStatementId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: enabled && !!ghgStatementId,
    staleTime: DEFAULT_STALE_MS,
    refetchInterval: (query) =>
      query.state.data?.isLockedInFlight ? LOCKED_REFETCH_INTERVAL_MS : false,
  });
}

// Submitted removals not yet absorbed by any statement — the stepper preview.
export function useOpenRemovalsForFacility(
  facilityId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: certificationKeys.openRemovalsForFacility(facilityId),
    queryFn: async () => {
      const result = await loadOpenRemovalsForFacility(facilityId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: enabled && !!facilityId,
    staleTime: DEFAULT_STALE_MS,
  });
}

// Period-first create — picks an end date; the server reconciles members.
export function useCreateGhgStatement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateGhgStatementInput) => {
      const result = await createGhgStatementDraft(input);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: certificationKeys.all });
    },
  });
}

// Submit (or resubmit) a statement to the verifier with a report URL.
export function useSubmitGhgStatementToVerifier() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      ghgStatementId: string;
      input: SubmitGhgStatementDialogInput;
    }) => {
      const result = await submitGhgStatementToVerifier(
        vars.ghgStatementId,
        vars.input,
      );
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: certificationKeys.all });
    },
  });
}

// Re-fetch remote status and re-reconcile removal membership.
export function useRefreshGhgStatementStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (submissionId: string) => {
      const result = await refreshGhgStatementStatus(submissionId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: certificationKeys.all });
    },
  });
}
