/**
 * Certification React Query hooks
 * Manages the facility ↔ Isometric project mapping and the Removal
 * submission flow (N credit batches → 1 Isometric Removal — ADR 0003).
 */

import { activityKeys } from "./activity-query-keys";
import {
  type QueryClient,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createGhgStatementDraft,
  approveGhgStatementReport,
  createRemovalWithBatchesAction,
  deleteRemovalAction,
  deleteFacilityCertifierMapping,
  loadBatchHealth,
  loadCreditBatchDurabilitySummary,
  loadCertificationHealth,
  loadCertificationOverview,
  loadCreditBatchHealthSummaries,
  loadCertifyContextForCreditBatch,
  loadFacilityCertifierMapping,
  loadGhgStatementBreakdown,
  loadGhgStatementReports,
  loadGhgStatementsForFacility,
  loadGhgStatementState,
  loadIsometricFeedstockTypes,
  loadIsometricProjectTemplates,
  loadOpenRemovalsForFacility,
  loadRegistryGhgStatements,
  loadRegistrySourceVisibility,
  loadRemovalBreakdown,
  loadRemovalCompilation,
  loadRemovalTemplateDiagnostic,
  loadRemovalProductionBatches,
  loadRemovalCertifyContext,
  loadRemovalPreflight,
  loadRemovalsForFacility,
  loadSelectableBatchesForFacility,
  refreshGhgStatementStatus,
  prepareGhgStatementReport,
  reconcileGhgStatementsFromRegistry,
  saveFacilityCertifierMapping,
  saveFacilityEmissionConfig,
  saveRegistrySourceVisibility,
  type CreditBatchHealthSummary,
} from "@/fn/certification";
import { getFacilityCertifierSummaryRead } from "@/lib/read-api/client";
import type { RemovalSubmissionResult } from "@/fn/certification/submit-removal";
import type { SubmitGhgStatementResult } from "@/fn/certification/submit-ghg-statement";
import {
  streamCertificationSubmission,
} from "@/lib/certification/submission-progress-client";
import type { SubmissionProgressUpdate } from "@/lib/certification/submission-progress";
import { invalidateOnboardingProgress } from "./use-onboarding";
import type {
  CreateGhgStatementInput,
  CreateRemovalWithBatchesInput,
  DeleteRemovalInput,
  FacilityEmissionConfigFormData,
  RegistrySourceVisibilityInput,
  SaveMappingInput,
  SubmitGhgStatementDialogInput,
  SubmitRemovalInput,
  PrepareGhgStatementReportInput,
  ApproveGhgStatementReportInput,
} from "@/schemas/certification";
import { creditBatchKeys } from "./credit-batch-query-keys";
import { unwrap } from "@/hooks/types";

// Stale-time policy for certification queries. `LOCKED_REFETCH_INTERVAL_MS`
// drives the in-flight polling cadence in `useCertifyContextForCreditBatch`
// and `useGhgStatementState`; the project-templates list is read rarely so
// it gets its own longer stale window.
const DEFAULT_STALE_MS = 30_000;
const PROJECT_TEMPLATES_STALE_MS = 60_000;
const LOCKED_REFETCH_INTERVAL_MS = 60_000;
const BATCH_HEALTH_SUMMARY_CHUNK_SIZE = 50;

type RemovalCertifyPollingData = {
  latestSubmission?: { lockedAt?: Date | string | null } | null;
  futureDatedMeasurements?: readonly string[];
};

export function getRemovalCertifyRefetchInterval(
  data: RemovalCertifyPollingData | undefined,
): number | false {
  return data?.latestSubmission?.lockedAt ||
    (data?.futureDatedMeasurements?.length ?? 0) > 0
    ? LOCKED_REFETCH_INTERVAL_MS
    : false;
}

type RemovalPreflightPollingData = {
  lockInFlight: boolean;
};

export function getRemovalPreflightRefetchInterval(
  data: RemovalPreflightPollingData | undefined,
): number | false {
  return data?.lockInFlight ? LOCKED_REFETCH_INTERVAL_MS : false;
}

export const certificationKeys = {
  all: ["certification"] as const,
  /** Whether a submitted Removal or GHG statement freezes the record's files. */
  recordLock: (entityType: string, entityId?: string) =>
    [...certificationKeys.all, "record-lock", entityType, entityId] as const,
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
  certifyContextForRemoval: (facilityId: string, removalId: string) =>
    [
      ...certificationKeys.all,
      "certify-context",
      "removal",
      facilityId,
      removalId,
    ] as const,
  removalPreflight: (facilityId: string, removalId: string) =>
    [
      ...certificationKeys.all,
      "removal-preflight",
      facilityId,
      removalId,
    ] as const,
  removalCompilation: (facilityId: string, removalId: string) =>
    [
      ...certificationKeys.all,
      "removal-compilation",
      facilityId,
      removalId,
    ] as const,
  removalTemplateDiagnostic: (facilityId: string) =>
    [
      ...certificationKeys.all,
      "removal-template-diagnostic",
      facilityId,
    ] as const,
  removalsForFacility: (facilityId: string) =>
    [...certificationKeys.all, "removals", facilityId] as const,
  removalBreakdown: (removalId: string) =>
    [...certificationKeys.all, "removal-breakdown", removalId] as const,
  removalProductionBatches: (removalId: string) =>
    [...certificationKeys.all, "removal-production-batches", removalId] as const,
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
  ghgStatementReports: (ghgStatementId: string) =>
    [
      ...certificationKeys.all,
      "ghg-statement-reports",
      ghgStatementId,
    ] as const,
  openRemovalsForFacility: (facilityId: string) =>
    [...certificationKeys.all, "open-removals", facilityId] as const,
  registryGhgStatementsForFacility: (facilityId: string) =>
    [...certificationKeys.all, "registry-ghg-statements", facilityId] as const,
  overview: (facilityId: string) =>
    [...certificationKeys.all, "overview", facilityId] as const,
  health: () => [...certificationKeys.all, "health"] as const,
  registrySourceVisibility: () =>
    [...certificationKeys.all, "registry-source-visibility"] as const,
};

/** Refresh cached readiness and activity and, when relevant, derived CO₂e previews. */
export function invalidateCertificationReadiness(
  queryClient: QueryClient,
  options?: { creditBatchPreviews?: boolean },
) {
  const invalidations = [
    // Readiness-affecting mutations also change the batch activity history.
    queryClient.invalidateQueries({ queryKey: activityKeys.all }),
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
    queryFn: async () => unwrap(await loadCertificationOverview(facilityId)),
    enabled: enabled && !!facilityId,
    staleTime: DEFAULT_STALE_MS,
  });
}

export function useRemovalPreflightSummaries(
  facilityId: string,
  removalIds: string[],
) {
  const results = useQueries({
    queries: removalIds.map((removalId) => ({
      queryKey: certificationKeys.removalPreflight(facilityId, removalId),
      queryFn: async () => unwrap(await loadRemovalPreflight(facilityId, removalId)),
      enabled: Boolean(facilityId && removalId),
      staleTime: DEFAULT_STALE_MS,
      refetchInterval: (query: {
        state: { data?: RemovalPreflightPollingData };
      }) =>
        getRemovalPreflightRefetchInterval(query.state.data),
    })),
  });

  return Object.fromEntries(
    removalIds.map((removalId, index) => {
      const result = results[index];
      return [
        removalId,
        {
          status: result?.isError
            ? ("unavailable" as const)
            : result?.data
              ? ("available" as const)
              : ("loading" as const),
          data: result?.data ?? null,
          retry: () => result?.refetch(),
        },
      ];
    }),
  );
}

// Read-only Isometric carbon result for one removal — lazy by design: the
// detail sheet only enables it while open. Reads the registry's GHG entry for
// submitted removals (its figures don't move once verified), so it leans on the
// default stale window and is invalidated alongside the rest of `all`.
export function useRemovalBreakdown(removalId: string, enabled = true) {
  return useQuery({
    queryKey: certificationKeys.removalBreakdown(removalId),
    queryFn: async () => unwrap(await loadRemovalBreakdown(removalId)),
    enabled: enabled && !!removalId,
    staleTime: DEFAULT_STALE_MS,
  });
}

// Registered production-batch identities for one removal — DB-only journal
// read, lazy like the breakdown: the detail sheet only enables it while open.
// Identities are immutable once registered, so the default stale window is
// safe; invalidated alongside the rest of `all` after a submission.
export function useRemovalProductionBatches(removalId: string, enabled = true) {
  return useQuery({
    queryKey: certificationKeys.removalProductionBatches(removalId),
    queryFn: async () => unwrap(await loadRemovalProductionBatches(removalId)),
    enabled: enabled && !!removalId,
    staleTime: DEFAULT_STALE_MS,
  });
}

// Read-only integration status for the Settings → Health panel. Admin-gated
// server-side; read rarely, so it gets the longer stale window.
export function useCertificationHealth() {
  return useQuery({
    queryKey: certificationKeys.health(),
    queryFn: async () => unwrap(await loadCertificationHealth()),
    staleTime: PROJECT_TEMPLATES_STALE_MS,
  });
}

export function useRegistrySourceVisibility() {
  return useQuery({
    queryKey: certificationKeys.registrySourceVisibility(),
    queryFn: async () => unwrap(await loadRegistrySourceVisibility()),
    staleTime: DEFAULT_STALE_MS,
  });
}

export function useSaveRegistrySourceVisibility() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: RegistrySourceVisibilityInput) =>
      unwrap(await saveRegistrySourceVisibility(input)),
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
    queryFn: async () => unwrap(await loadFacilityCertifierMapping(facilityId)),
    enabled: enabled && !!facilityId,
    staleTime: DEFAULT_STALE_MS,
  });
}

// Read-only registry-link summary (DB-only, no Isometric API). For viewers who
// can't manage the link — keeps the management payload (available projects,
// templates, and facility identities) off the wire while exposing only the
// linked-facility count needed for safe GHG Statement creation. Mutations
// invalidate `certificationKeys.all`, which covers this key too.
export function useFacilityCertifierSummary(
  facilityId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: certificationKeys.facilitySummary(facilityId),
    queryFn: async ({ signal }) =>
      unwrap(
        await getFacilityCertifierSummaryRead(facilityId, {
          signal,
        }),
      ),
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
      return unwrap(await loadIsometricProjectTemplates(externalProjectId));
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
    queryFn: async () => unwrap(await loadIsometricFeedstockTypes()),
    enabled,
    staleTime: PROJECT_TEMPLATES_STALE_MS,
  });
}

export function useSaveFacilityCertifierMapping() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SaveMappingInput) =>
      unwrap(await saveFacilityCertifierMapping(input)),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: certificationKeys.facilityMapping(variables.facilityId),
      });
      queryClient.invalidateQueries({ queryKey: certificationKeys.all });
      invalidateOnboardingProgress(queryClient, variables.facilityId);
    },
  });
}

export function useSaveFacilityEmissionConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: FacilityEmissionConfigFormData) =>
      unwrap(await saveFacilityEmissionConfig(input)),
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
    queryFn: async () => unwrap(await loadCertifyContextForCreditBatch(creditBatchId)),
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
    queryFn: async () => unwrap(await loadBatchHealth(creditBatchId)),
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
    queryFn: async () => unwrap(await loadCreditBatchDurabilitySummary(creditBatchId)),
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
        return unwrap(await loadCreditBatchHealthSummaries(facilityId, ids));
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
// credit-batch variant it refetches while a submission is locked in flight.
// It also polls while a clock-derived future-date blocker exists so an open
// dialog becomes ready when that timestamp passes, without broad idle polling.
export function useRemovalCertifyContext(
  facilityId: string,
  removalId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: certificationKeys.certifyContextForRemoval(
      facilityId,
      removalId,
    ),
    queryFn: async () => unwrap(await loadRemovalCertifyContext(facilityId, removalId)),
    enabled: enabled && !!facilityId && !!removalId,
    staleTime: DEFAULT_STALE_MS,
    refetchInterval: (query) =>
      getRemovalCertifyRefetchInterval(query.state.data),
  });
}

export function useRemovalCompilation(
  facilityId: string,
  removalId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: certificationKeys.removalCompilation(facilityId, removalId),
    queryFn: async () => unwrap(await loadRemovalCompilation(facilityId, removalId)),
    enabled: enabled && !!facilityId && !!removalId,
    staleTime: DEFAULT_STALE_MS,
  });
}

export function useRemovalTemplateDiagnostic(
  facilityId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: certificationKeys.removalTemplateDiagnostic(facilityId),
    queryFn: async () => unwrap(await loadRemovalTemplateDiagnostic(facilityId)),
    enabled: enabled && !!facilityId,
    staleTime: PROJECT_TEMPLATES_STALE_MS,
  });
}

// Removals hub listing for a facility — removals + members + status, plus
// the pool of credit batches not yet grouped into a removal.
export function useRemovalsForFacility(facilityId: string, enabled = true) {
  return useQuery({
    queryKey: certificationKeys.removalsForFacility(facilityId),
    queryFn: async () => unwrap(await loadRemovalsForFacility(facilityId)),
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
    queryFn: async () => unwrap(await loadSelectableBatchesForFacility(facilityId)),
    enabled: enabled && !!facilityId,
    staleTime: DEFAULT_STALE_MS,
  });
}

// Submits an existing removal directly (the workspace's single submit entry).
export function useSubmitRemoval() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      input: SubmitRemovalInput;
      onProgress: (update: SubmissionProgressUpdate) => void;
    }) =>
      streamCertificationSubmission<RemovalSubmissionResult>(
        { kind: "removal", input: vars.input },
        vars.onProgress,
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: certificationKeys.all }),
    onError: () => {
      // A Removal failure can happen after its draft was claimed. Refresh the
      // submission state before the operator returns to review so the active
      // lock, if any, gates the next attempt.
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
    mutationFn: async (input: CreateRemovalWithBatchesInput) =>
      unwrap(await createRemovalWithBatchesAction(input)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: certificationKeys.all });
    },
  });
}

export function useDeleteRemoval() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: DeleteRemovalInput) => unwrap(await deleteRemovalAction(input)),
    onSuccess: () =>
      invalidateCertificationReadiness(queryClient, {
        creditBatchPreviews: true,
      }),
  });
}

export function useDeleteFacilityCertifierMapping() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (facilityId: string) =>
      unwrap(await deleteFacilityCertifierMapping(facilityId)),
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
    queryFn: async () => unwrap(await loadGhgStatementsForFacility(facilityId)),
    enabled: enabled && !!facilityId,
    staleTime: DEFAULT_STALE_MS,
  });
}

// Read-only view of the project's registry statements. This is a *query*, so
// it must not write: it previously called the reconcile action, which meant
// merely opening the create dialog performed an unannounced sync (advancing
// `updated_at` and discarding both of the reconcile's counters). Reconciling
// is an explicit operator action — `useSyncGhgStatementsFromRegistry`.
export function useRegistryGhgStatementsForFacility(
  facilityId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: certificationKeys.registryGhgStatementsForFacility(facilityId),
    queryFn: async () => unwrap(await loadRegistryGhgStatements(facilityId)),
    enabled: enabled && !!facilityId,
    staleTime: DEFAULT_STALE_MS,
  });
}

export function useSyncGhgStatementsFromRegistry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (facilityId: string) =>
      unwrap(await reconcileGhgStatementsFromRegistry(facilityId)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: certificationKeys.all });
    },
  });
}

// One statement's detail state. Refetches while a submission is locked in
// flight so the panel reflects progress without a manual refresh.
export function useGhgStatementState(ghgStatementId: string, enabled = true) {
  return useQuery({
    queryKey: certificationKeys.ghgStatementState(ghgStatementId),
    queryFn: async () => unwrap(await loadGhgStatementState(ghgStatementId)),
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
    queryFn: async () => unwrap(await loadGhgStatementBreakdown(ghgStatementId)),
    enabled: enabled && !!ghgStatementId,
    staleTime: DEFAULT_STALE_MS,
  });
}

export function useGhgStatementReports(
  ghgStatementId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: certificationKeys.ghgStatementReports(ghgStatementId),
    queryFn: async () => unwrap(await loadGhgStatementReports(ghgStatementId)),
    enabled: enabled && !!ghgStatementId,
    staleTime: DEFAULT_STALE_MS,
  });
}

export function usePrepareGhgStatementReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: PrepareGhgStatementReportInput) =>
      unwrap(await prepareGhgStatementReport(input)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: certificationKeys.all });
    },
  });
}

export function useApproveGhgStatementReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ApproveGhgStatementReportInput) =>
      unwrap(await approveGhgStatementReport(input)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: certificationKeys.all });
    },
  });
}

// Submitted removals not yet absorbed by any statement — the stepper preview.
export function useOpenRemovalsForFacility(
  facilityId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: certificationKeys.openRemovalsForFacility(facilityId),
    queryFn: async () => unwrap(await loadOpenRemovalsForFacility(facilityId)),
    enabled: enabled && !!facilityId,
    staleTime: DEFAULT_STALE_MS,
  });
}

// Period-first create — picks an end date; the server reconciles members.
export function useCreateGhgStatement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateGhgStatementInput) =>
      unwrap(await createGhgStatementDraft(input)),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: certificationKeys.all }),
  });
}

// Submit (or resubmit) a statement to the verifier with a report URL.
export function useSubmitGhgStatementToVerifier() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      ghgStatementId: string;
      input: SubmitGhgStatementDialogInput;
      onProgress: (update: SubmissionProgressUpdate) => void;
    }) => {
      return streamCertificationSubmission<SubmitGhgStatementResult>(
        {
          kind: "ghg_statement",
          ghgStatementId: vars.ghgStatementId,
          input: vars.input,
        },
        vars.onProgress,
      );
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: certificationKeys.all }),
    onError: () => {
      queryClient.invalidateQueries({ queryKey: certificationKeys.all });
    },
  });
}

// Re-fetch remote status and re-reconcile removal membership.
export function useRefreshGhgStatementStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (submissionId: string) =>
      unwrap(await refreshGhgStatementStatus(submissionId)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: certificationKeys.all });
    },
  });
}
