/**
 * Empty components of a draft Removal (epic #1058, PR 4): the components with
 * nothing recorded for this Removal, and the zero entries that confirm them.
 * The server owns what counts as empty; these hooks only read it and write the
 * recorded zeros.
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getRemovalEmptyLinesFn,
  recordEmissionZerosFn,
  undoEmissionZerosFn,
} from "@/fn/certification/emission-zeros";
import { throwActionError } from "@/lib/stale-version";
import type { ActionResult } from "@/types/actions";
import { loadRemovalCertifyContext } from "@/fn/certification";
import { landingStep } from "@/lib/certification/empty-components-state";
import {
  certificationKeys,
  invalidateCertificationReadiness,
} from "./use-certification";

type EmptyLinesResult = Awaited<ReturnType<typeof getRemovalEmptyLinesFn>>;
export type RemovalEmptyComponents = Extract<
  EmptyLinesResult,
  { success: true }
>["data"];
export type RemovalEmptyComponentsBatch =
  RemovalEmptyComponents["batches"][number];

function unwrapZero<T>(result: ActionResult<T>): T {
  if (!result.success) throwActionError(result);
  return result.data;
}

async function readEmptyComponents(removalId: string) {
  return unwrapZero(await getRemovalEmptyLinesFn({ removalId }));
}

/**
 * The step's data. `refetchOnFocus` brings back what the operator added on the
 * batch's Emissions page in another tab, so the step reflects it on return.
 */
export function useRemovalEmptyComponents(
  removalId: string | null,
  options: { enabled?: boolean; refetchOnFocus?: boolean } = {},
) {
  const { enabled = true, refetchOnFocus = false } = options;
  return useQuery({
    queryKey: certificationKeys.removalEmptyLines(removalId ?? ""),
    queryFn: () => readEmptyComponents(removalId!),
    enabled: enabled && !!removalId,
    staleTime: 0,
    // The server refuses the read while entries are switched off: do not retry.
    retry: false,
    refetchOnWindowFocus: refetchOnFocus ? "always" : false,
  });
}

/**
 * A fresh read for a decision (where to land after the Removal is created, or
 * whether Continue may proceed). Resolves to null when the read is unavailable.
 */
export function useLoadRemovalEmptyComponents() {
  const queryClient = useQueryClient();
  return async (removalId: string): Promise<RemovalEmptyComponents | null> => {
    try {
      return await queryClient.fetchQuery({
        queryKey: certificationKeys.removalEmptyLines(removalId),
        queryFn: () => readEmptyComponents(removalId),
        staleTime: 0,
        retry: false,
      });
    } catch {
      return null;
    }
  };
}

/** Refreshes the Removal's context and review before the submit step reads them. */
export function useRefreshRemovalReview() {
  const queryClient = useQueryClient();
  return () => invalidateCertificationReadiness(queryClient);
}

interface ZeroScope {
  removalId: string;
  creditBatchId: string;
  /** The version the operator last saw; a changed Removal is refused. */
  expectedRemovalVersion: number | null;
}

/**
 * Where a New Removal opens: the empty components step while any is
 * unconfirmed, the submit step otherwise, and straight to submit when the
 * emissions entries switch is off (the server supplies it on the context).
 * Resolved once per Removal: later edits must not move the operator, so the
 * key sits outside `certificationKeys.all`, which every write invalidates.
 */
export function useRemovalLanding(
  removalId: string | null,
  facilityId: string,
  enabled: boolean,
) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ["removal-landing", removalId ?? ""],
    queryFn: async () => {
      // The dialog reads the same context: share it instead of loading it twice.
      const ctx = await queryClient.ensureQueryData({
        queryKey: certificationKeys.certifyContextForRemoval(facilityId, removalId!),
        queryFn: async () => unwrapZero(await loadRemovalCertifyContext(facilityId, removalId!)),
        staleTime: 30_000,
      });
      if (!ctx.emissionsEntriesEnabled) return { entriesEnabled: false, step: "submit" as const };
      return { entriesEnabled: true, step: landingStep(await readEmptyComponents(removalId!)) };
    },
    enabled: enabled && !!removalId,
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

/**
 * Record and undo as one unit: one write at a time (the Removal version moves
 * with each), and a stale error from one never outlives the other.
 */
export function useEmptyComponentsActions() {
  const queryClient = useQueryClient();
  const record = useMutation({
    mutationFn: async (input: ZeroScope & { componentIds: string[]; note: string }) =>
      unwrapZero(
        await recordEmissionZerosFn({
          removalId: input.removalId,
          creditBatchId: input.creditBatchId,
          componentIds: input.componentIds,
          note: input.note,
          ...(input.expectedRemovalVersion !== null
            ? { expectedRemovalVersion: input.expectedRemovalVersion }
            : {}),
        }),
      ),
    // Awaited: the write stays pending until the reads behind it are fresh.
    onSettled: () => invalidateCertificationReadiness(queryClient),
  });
  const undo = useMutation({
    mutationFn: async (input: ZeroScope) =>
      unwrapZero(
        await undoEmissionZerosFn({
          removalId: input.removalId,
          creditBatchId: input.creditBatchId,
          ...(input.expectedRemovalVersion !== null
            ? { expectedRemovalVersion: input.expectedRemovalVersion }
            : {}),
        }),
      ),
    onSettled: () => invalidateCertificationReadiness(queryClient),
  });
  const failed = record.isError ? record : undo.isError ? undo : null;
  return {
    busy: record.isPending || undo.isPending,
    pendingBatchId: record.isPending
      ? record.variables?.creditBatchId
      : undo.isPending
        ? undo.variables?.creditBatchId
        : null,
    error: failed?.error ?? null,
    errorBatchId: failed?.variables?.creditBatchId ?? null,
    recordZeros: (input: ZeroScope & { componentIds: string[]; note: string }) => {
      undo.reset();
      record.mutate(input);
    },
    undoZeros: (input: ZeroScope) => {
      record.reset();
      undo.mutate(input);
    },
  };
}

export type EmptyComponentsActions = ReturnType<typeof useEmptyComponentsActions>;
