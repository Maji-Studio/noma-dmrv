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

export function useRecordEmissionZeros() {
  const queryClient = useQueryClient();
  return useMutation({
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
    onSettled: () => invalidateCertificationReadiness(queryClient),
  });
}

export function useUndoEmissionZeros() {
  const queryClient = useQueryClient();
  return useMutation({
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
}
