/**
 * Production Processes React Query hooks (read-only, ADR 0017 Track 1.5).
 *
 * A production process is the (facility, feedstock) sampling-regime campaign
 * that scopes Method A/B. This surface is read-only today; the Method-B unlock
 * mutation ships with Track 2.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ProcessCarbonPreview,
  ProcessComplianceDriftResult,
  ProductionProcessSummary,
} from "@/data-access/production-processes";
import {
  getProcessComplianceDriftFn,
  getProductionProcessSummariesByFacilityFn,
  getUnsampledCarbonPreviewFn,
  setProcessOperationalStartFn,
  startNewProductionProcessFn,
  unlockMethodBFn,
} from "@/fn/production-processes";
import type {
  SetOperationalStartInput,
  StartNewProcessInput,
  UnlockMethodBInput,
} from "@/schemas/production-process";

export const productionProcessKeys = {
  all: ["production-processes"] as const,
  byFacility: (facilityId: string) =>
    [...productionProcessKeys.all, "byFacility", facilityId] as const,
  carbonPreview: (processId: string) =>
    [...productionProcessKeys.all, "carbonPreview", processId] as const,
  complianceDrift: (processId: string) =>
    [...productionProcessKeys.all, "complianceDrift", processId] as const,
};

/**
 * Fetch a facility's production-process summaries (sampling method, Method-B
 * baseline progress, cadence status).
 */
export function useProductionProcessesByFacility(
  facilityId: string | null | undefined,
  enabled = true,
) {
  return useQuery<ProductionProcessSummary[]>({
    queryKey: productionProcessKeys.byFacility(facilityId ?? ""),
    queryFn: async () => {
      const result = await getProductionProcessSummariesByFacilityFn(
        facilityId as string,
      );
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    enabled: enabled && !!facilityId,
    staleTime: 30000,
  });
}

/**
 * Non-authoritative unsampled-carbon preview (Eq 4/5) for a process (ADR 0017
 * item 6). Disabled until a `processId` is supplied. Historical-ish data → 5-min
 * stale time. The registry computes the credited number (D1); this is a preview.
 */
export function useUnsampledCarbonPreview(
  processId: string | null | undefined,
  asOfDateIso?: string,
  enabled = true,
) {
  return useQuery<ProcessCarbonPreview>({
    queryKey: [
      ...productionProcessKeys.carbonPreview(processId ?? ""),
      asOfDateIso ?? "now",
    ],
    queryFn: async () => {
      const result = await getUnsampledCarbonPreviewFn(
        processId as string,
        asOfDateIso,
      );
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    enabled: enabled && !!processId,
    staleTime: 300000,
  });
}

/**
 * Trailing-window compliance counters for a process (ADR 0017 item 7). Warn-only.
 */
export function useProcessComplianceDrift(
  processId: string | null | undefined,
  asOfDateIso?: string,
  enabled = true,
) {
  return useQuery<ProcessComplianceDriftResult>({
    queryKey: [
      ...productionProcessKeys.complianceDrift(processId ?? ""),
      asOfDateIso ?? "now",
    ],
    queryFn: async () => {
      const result = await getProcessComplianceDriftFn(
        processId as string,
        asOfDateIso,
      );
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    enabled: enabled && !!processId,
    staleTime: 300000,
  });
}

/**
 * Unlock Method B for a production process (ADR 0017 Track 2). On success,
 * invalidate the production-process list so the row reflects its new method,
 * cleared baseline, and Method-B cadence.
 */
export function useUnlockMethodB() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UnlockMethodBInput) => {
      const result = await unlockMethodBFn(input);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: productionProcessKeys.all });
    },
  });
}

/**
 * Set a production process's operational start (`established_at`). On success,
 * invalidate every production-process key: the facility summaries re-derive their
 * baseline counts (samples now inside the corrected window count), and the
 * per-process carbon-preview / compliance-drift reads re-run against the new
 * window.
 */
export function useSetProcessOperationalStart() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SetOperationalStartInput) => {
      const result = await setProcessOperationalStartFn(input);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: productionProcessKeys.all });
    },
  });
}

/**
 * Start a new production process (ADR 0017 item 7 / D6): the manual baseline
 * reset. On success, invalidate the list so the new (Method A, zero-baseline)
 * process appears and becomes current for the pair.
 */
export function useStartNewProductionProcess() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: StartNewProcessInput) => {
      const result = await startNewProductionProcessFn(input);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: productionProcessKeys.all });
    },
  });
}
