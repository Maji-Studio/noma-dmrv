/**
 * Emissions entries on one credit batch (epic #1058): the batch's emission
 * lines and the manual entry writes. Every write refreshes the lines, the
 * facility Emissions overview, batch health and the Energy page, because all
 * four read the same entries.
 */
"use client";

import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  confirmEmissionEntryFn,
  createEmissionEntryFn,
  deleteEmissionEntryFn,
  getBatchEmissionLinesFn,
  markNothingToRecordFn,
  updateEmissionEntryFn,
} from "@/fn/emission-entries";
import { throwActionError } from "@/lib/stale-version";
import type { ActionResult } from "@/types/actions";
import type { EmissionLineRecords, EmissionRecordSource } from "@/lib/certification/emission-lines";
import { activityKeys } from "./activity-query-keys";
import { creditBatchKeys } from "./credit-batch-query-keys";
import { certificationKeys } from "./use-certification";
import { energyKeys } from "./use-energy";

type LinesResult = Awaited<ReturnType<typeof getBatchEmissionLinesFn>>;
type ServerLine = Extract<LinesResult, { success: true }>["data"][number];

export type RecordsSource = EmissionRecordSource;
export type LineRecords = EmissionLineRecords;
/** A line as the page reads it. `groupName` (the template group's display name) is optional until the server sends it. */
export type EmissionLine = ServerLine & { groupName?: string };
export type EmissionEntry = EmissionLine["entries"][number];
export type EmissionInput = EmissionLine["inputShape"][number];

function unwrapEntry<T>(result: ActionResult<T>): T {
  if (!result.success) throwActionError(result);
  return result.data;
}

export interface EmissionBatchScope {
  facilityId: string;
  creditBatchId: string;
}

export function useBatchEmissionLines(scope: EmissionBatchScope | null) {
  return useQuery({
    queryKey: scope
      ? creditBatchKeys.emissionLines(scope.facilityId, scope.creditBatchId)
      : creditBatchKeys.emissionLines("", ""),
    queryFn: async (): Promise<EmissionLine[]> => unwrapEntry(await getBatchEmissionLinesFn(scope!)),
    enabled: !!scope,
    // Records come from runs, legs, deliveries and applications edited on
    // other pages; refetch on every visit rather than wiring all of them here.
    staleTime: 0,
  });
}

/** Everything that reads emissions entries. Also used after a file upload. */
export function invalidateEmissionEntryReads(queryClient: QueryClient, scope: EmissionBatchScope) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: creditBatchKeys.emissionLines(scope.facilityId, scope.creditBatchId) }),
    queryClient.invalidateQueries({ queryKey: creditBatchKeys.emissionsOverview(scope.facilityId) }),
    queryClient.invalidateQueries({ queryKey: certificationKeys.batchHealth(scope.creditBatchId) }),
    queryClient.invalidateQueries({ queryKey: energyKeys.all }),
    queryClient.invalidateQueries({ queryKey: activityKeys.all }),
  ]);
}

function useEntryMutation<TInput, TData>(scope: EmissionBatchScope, run: (input: TInput) => Promise<ActionResult<TData>>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: TInput) => unwrapEntry(await run(input)),
    // Refresh after failures too: a stale version means the lines moved.
    onSettled: () => invalidateEmissionEntryReads(queryClient, scope),
  });
}

export function useCreateEmissionEntry(scope: EmissionBatchScope) {
  return useEntryMutation(scope, createEmissionEntryFn);
}
export function useUpdateEmissionEntry(scope: EmissionBatchScope) {
  return useEntryMutation(scope, updateEmissionEntryFn);
}
export function useConfirmEmissionEntry(scope: EmissionBatchScope) {
  return useEntryMutation(scope, confirmEmissionEntryFn);
}
export function useDeleteEmissionEntry(scope: EmissionBatchScope) {
  return useEntryMutation(scope, deleteEmissionEntryFn);
}
export function useMarkNothingToRecord(scope: EmissionBatchScope) {
  return useEntryMutation(scope, markNothingToRecordFn);
}
