/**
 * Certification React Query hooks
 * Manages the facility ↔ Isometric project mapping and the Removal
 * submission flow (N credit batches → 1 Isometric Removal — ADR 0003).
 */

import {
  type QueryClient,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createGhgStatementDraft,
  createRemovalWithBatchesAction,
  deleteFacilityCertifierMapping,
  loadBatchHealth,
  loadCreditBatchDurabilitySummary,
  loadCertificationHealth,
  loadCertificationOverview,
  loadCreditBatchHealthSummaries,
  loadCertifyContextForCreditBatch,
  loadFacilityCertifierMapping,
  loadFacilityCertifierSummary,
  loadGhgStatementBreakdown,
  loadGhgStatementsForFacility,
  loadGhgStatementState,
  loadIsometricFeedstockTypes,
  loadIsometricProjectTemplates,
  loadOpenRemovalsForFacility,
  loadRegistrySourceVisibility,
  loadRemovalBreakdown,
  loadRemovalCertifyContext,
  loadRemovalsForFacility,
  loadSelectableBatchesForFacility,
  refreshGhgStatementStatus,
  saveFacilityCertifierMapping,
  saveFacilityEmissionConfig,
  saveRegistrySourceVisibility,
  submitGhgStatementToVerifier,
  submitRemovalAction,
  type CreditBatchHealthSummary,
} from "@/fn/certification";
import type {
  CreateGhgStatementInput,
  CreateRemovalWithBatchesInput,
  FacilityEmissionConfigFormData,
  RegistrySourceVisibilityInput,
  SaveMappingInput,
  SubmitGhgStatementDialogInput,
  SubmitRemovalInput,
} from "@/schemas/certification";
import { creditBatchKeys } from "./credit-batch-query-keys";

// Stale-time policy for certification queries. `LOCKED_REFETCH_INTERVAL_MS`
// drives the in-flight polling cadence in `useCertifyContextForCreditBatch`
// and `useGhgStatementState`; the project-templates list is read rarely so
// it gets its own longer stale window.
const DEFAULT_STALE_MS = 30_000;
const PROJECT_TEMPLATES_STALE_MS = 60_000;
const LOCKED_REFETCH_INTERVAL_MS = 60_000;
const BATCH_HEALTH_SUMMARY_CHUNK_SIZE = 50;

export const certificationKeys = {
  all: ["certification"] as const,
  facilityMapping: (facilityId: string) =>
    [...certificationKeys.all, "facility-mapping", facilityId] as const,
  facilitySummary: (facilityId: string) =>
    [...certificationKeys.all, "facility-summary", facilityId] as const,
  projectTemplates: (externalProjectId: string) =>
    [...certificationKeys.all, "project-templates", externalProjectId] as const,
  feedstockTypes: () =>
    [...certificationKeys.all, "feedstock-types"] as const,
  certifyContextForCreditBatch: (creditBatchId: string) =>
    [
      ...certificationKeys.all,
      "certify-context",
      "credit-batch",
      creditBatchId,
    ] as const,
  batchHealth: (creditBatchId: string) =>
    [...certificationKeys.all, "batch-health", creditBatchId] as const,
  batchDurabilitySummary: (creditBatchId: string) =>
    [
      ...certificationKeys.all,
      "batch-durability-summary",
      creditBatchId,
    ] as const,
  batchHealthSummaries: (facilityId: string, batchIds: string[]) =>
    [
      ...certificationKeys.all,
      "batch-health-summaries",
      facilityId,
      batchIds,
    ] as const,
  certifyContextForRemoval: (removalId: string) =>
    [
      ...certificationKeys.all,
      "certify-context",
      "removal",
      removalId,
    ] as const,
  removalsForFacility: (facilityId: string) =>
    [...certificationKeys.all, "removals", facilityId] as const,
  removalBreakdown: (removalId: string) =>
    [...certificationKeys.all, "removal-breakdown", removalId] as const,
  selectableBatches: (facilityId: string) =>
    [...certificationKeys.all, "selectable-batches", facilityId] as const,
  ghgStatementsForFacility: (facilityId: string) =>
    [...certificationKeys.all, "ghg-statements", facilityId] as const,
  ghgStatementState: (ghgStatementId: string) =>
    [...certificationKeys.all, "ghg-statement", ghgStatementId] as const,
  ghgStatementBreakdown: (ghgStatementId: string) =>
    [
      ...certificationKeys.all,
      "ghg-statement-breakdown",
      ghgStatementId,
    ] as const,
  openRemovalsForFacility: (facilityId: string) =>
    [...certificationKeys.all, "open-removals", facilityId] as const,
  overview: (facilityId: string) =>
    [...certificationKeys.all, "overview", facilityId] as const,
  health: () => [...certificationKeys.all, "health"] as const,
  registrySourceVisibility: () =>
    [...certificationKeys.all, "registry-source-visibility"] as const,
};

/** Refresh cached readiness and, when relevant, derived CO₂e previews. */
export function invalidateCertificationReadiness(
  queryClient: QueryClient,
  options?: { creditBatchPreviews?: boolean },
) {
  const invalidations = [
    queryClient.invalidateQueries({ queryKey: certificationKeys.all }),
  ];
  if (options?.creditBatchPreviews) {
    invalidations.push(
      queryClient.invalidateQueries({
        queryKey: creditBatchKeys.previewsPrefix(),
      }),
      queryClient.invalidateQueries({
        queryKey: creditBatchKeys.details(),
      }),
    );
  }
  return Promise.all(invalidations);
}

// Server-owned readiness payload for the Removals hub. Heavier than the other
// reads (walks lineage/coverage per removal), so it leans on React Query
// caching; mutations invalidate `certificationKeys.all`, refreshing it.
export function useCertificationOverview(facilityId: string, enabled = true) {
  return useQuery({
    queryKey: certificationKeys.overview(facilityId),
    queryFn: async () => {
      const result = await loadCertificationOverview(facilityId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: enabled && !!facilityId,
    staleTime: DEFAULT_STALE_MS,
  });
}

// Carbon-accounting breakdown for one removal — lazy by design: the removal
// detail sheet only enables it while open. Reads the registry's GHG entry for
// submitted removals (its figures don't move once verified), so it leans on the
// default stale window and is invalidated alongside the rest of `all`.
export function useRemovalBreakdown(removalId: string, enabled = true) {
  return useQuery({
    queryKey: certificationKeys.removalBreakdown(removalId),
    queryFn: async () => {
      const result = await loadRemovalBreakdown(removalId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: enabled && !!removalId,
    staleTime: DEFAULT_STALE_MS,
  });
}

// Read-only integration status for the Settings → Health panel. Admin-gated
// server-side; read rarely, so it gets the longer stale window.
export function useCertificationHealth() {
  return useQuery({
    queryKey: certificationKeys.health(),
    queryFn: async () => {
      const result = await loadCertificationHealth();
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    staleTime: PROJECT_TEMPLATES_STALE_MS,
  });
}

export function useRegistrySourceVisibility() {
  return useQuery({
    queryKey: certificationKeys.registrySourceVisibility(),
    queryFn: async () => {
      const result = await loadRegistrySourceVisibility();
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    staleTime: DEFAULT_STALE_MS,
  });
}

export function useSaveRegistrySourceVisibility() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: RegistrySourceVisibilityInput) => {
      const result = await saveRegistrySourceVisibility(input);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: certificationKeys.registrySourceVisibility(),
      });
    },
  });
}

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

// Read-only registry-link summary (DB-only, no Isometric API). For viewers who
// can't manage the link — keeps the management payload (available projects,
// templates, link hints) off the wire. Mutations invalidate
// `certificationKeys.all`, which covers this key too.
export function useFacilityCertifierSummary(
  facilityId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: certificationKeys.facilitySummary(facilityId),
    queryFn: async () => {
      const result = await loadFacilityCertifierSummary(facilityId);
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

// Registry feedstock-type catalogue (account-global, browse-only). Rarely
// changes — share the longer templates stale window.
export function useIsometricFeedstockTypes(enabled = true) {
  return useQuery({
    queryKey: certificationKeys.feedstockTypes(),
    queryFn: async () => {
      const result = await loadIsometricFeedstockTypes();
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled,
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

// Per-batch data-completeness verdict for the credit-batch detail page's
// health-check panel. Reuses the single-batch certify context server-side and
// runs the shared classifier. Mutations to the batch / its lineage invalidate
// `certificationKeys.all`, which covers this key.
export function useBatchHealth(creditBatchId: string, enabled = true) {
  return useQuery({
    queryKey: certificationKeys.batchHealth(creditBatchId),
    queryFn: async () => {
      const result = await loadBatchHealth(creditBatchId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: enabled && !!creditBatchId,
    staleTime: DEFAULT_STALE_MS,
  });
}

// Durability sampling roll-up + readiness for one credit batch — the detail
// page's durability section (sample list, submitted mean ± std-dev, eligibility /
// ≥3 / distribution) AND the lab-sample form's batch progress preview (samples
// anchor on the batch directly — issue #309; pass "" while no batch is chosen,
// the enabled guard keeps the query idle). Sample mutations invalidate this key
// directly (see use-samples.ts), so both surfaces reflect new chemistry without
// a manual refresh.
export function useBatchDurabilitySummary(
  creditBatchId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: certificationKeys.batchDurabilitySummary(creditBatchId),
    queryFn: async () => {
      const result = await loadCreditBatchDurabilitySummary(creditBatchId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: enabled && !!creditBatchId,
    staleTime: DEFAULT_STALE_MS,
  });
}

// Per-batch certification summaries for the Credit Batches cards and data
// filter, keyed by batch id. Each summary combines the canonical BatchHealth
// verdict with its Removal and linked GHG Statement status. The list passes the
// complete facility-scoped set; bounded chunks keep each request within its cap.
// Mutations to a batch / its lineage invalidate `certificationKeys.all`, which
// covers this key.
export function useCreditBatchHealthSummaries(
  facilityId: string | undefined,
  batchIds: string[],
) {
  const sortedIds = [...batchIds].sort();
  const chunks: string[][] = [];
  for (
    let index = 0;
    index < sortedIds.length;
    index += BATCH_HEALTH_SUMMARY_CHUNK_SIZE
  ) {
    chunks.push(sortedIds.slice(index, index + BATCH_HEALTH_SUMMARY_CHUNK_SIZE));
  }
  const results = useQueries({
    queries: chunks.map((ids) => ({
      queryKey: certificationKeys.batchHealthSummaries(
        facilityId ?? "",
        ids,
      ),
      queryFn: async () => {
        if (!facilityId) return {};
        const result = await loadCreditBatchHealthSummaries(facilityId, ids);
        if (!result.success) throw new Error(result.error);
        return result.data;
      },
      enabled: !!facilityId,
      staleTime: DEFAULT_STALE_MS,
    })),
  });

  return {
    data: results.reduce<Record<string, CreditBatchHealthSummary>>(
      (summaries, result) => Object.assign(summaries, result.data ?? {}),
      {},
    ),
    isLoading: results.some((result) => result.isLoading),
    isFetching: results.some((result) => result.isFetching),
    error: results.find((result) => result.error)?.error ?? null,
    refetch: () => Promise.all(results.map((result) => result.refetch())),
  };
}

// Removal-keyed Certify context for the guided Review flow. Like the
// credit-batch variant it refetches while a submission is locked in flight so
// the pre-flight reflects progress without a manual refresh.
export function useRemovalCertifyContext(removalId: string, enabled = true) {
  return useQuery({
    queryKey: certificationKeys.certifyContextForRemoval(removalId),
    queryFn: async () => {
      const result = await loadRemovalCertifyContext(removalId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: enabled && !!removalId,
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

// Ungrouped credit batches + per-batch health for the New-Removal wizard's
// selection step. Heavier than the plain ungrouped list (derives health per
// batch), so it leans on caching; grouping mutations invalidate
// `certificationKeys.all`, refreshing it.
export function useSelectableBatches(facilityId: string, enabled = true) {
  return useQuery({
    queryKey: certificationKeys.selectableBatches(facilityId),
    queryFn: async () => {
      const result = await loadSelectableBatchesForFacility(facilityId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: enabled && !!facilityId,
    staleTime: DEFAULT_STALE_MS,
  });
}

// Submits an existing removal directly (the workspace's single submit entry).
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

// Deferred-create — create a new removal from a confirmed set of healthy
// credit batches (the New-Removal wizard's "Confirm" step). The server
// re-validates batch health before writing; on success the wizard advances
// into the returned removal. Invalidates all certification queries since
// membership (and the ungrouped pool) changed.
export function useCreateRemovalWithBatches() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateRemovalWithBatchesInput) => {
      const result = await createRemovalWithBatchesAction(input);
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

// Carbon-accounting roll-up for one GHG statement — the sum across its member
// removals. Lazy by design: the statement detail sheet only mounts it while
// open. Like the removal variant it reads the registry's verified GHG entries
// for submitted members, so it leans on the default stale window and is
// invalidated alongside the rest of `all`.
export function useGhgStatementBreakdown(
  ghgStatementId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: certificationKeys.ghgStatementBreakdown(ghgStatementId),
    queryFn: async () => {
      const result = await loadGhgStatementBreakdown(ghgStatementId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: enabled && !!ghgStatementId,
    staleTime: DEFAULT_STALE_MS,
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
