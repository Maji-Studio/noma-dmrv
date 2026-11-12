/**
 * The proof files of a credit batch component (#1519): the From records
 * amount of a component whose proof setting is `lineFile` carries one set of
 * files. Every write refreshes the same reads as an entry write, because the
 * lines, readiness and the Removal's file count all read the set.
 */
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { attachEmissionLineFileFn, removeEmissionLineFileFn, replaceEmissionLineFilesFn } from "@/fn/emission-line-files";
import type { RequestUploadOverride } from "./use-file-upload";
import type { ActionResult } from "@/types/actions";
import { unwrap } from "./types";
import type { EmissionBatchScope } from "./use-emission-entries";
import { invalidateEmissionEntryReads } from "./stale-reads";
import { RECORD_LOCK_TOUCHES, recordLockMeta } from "./record-lock-query-keys";

/** The upload request for a component's file: the server makes the anchor with the first file. */
export function useEmissionLineFileUploadRequest(scope: EmissionBatchScope, componentId: string): RequestUploadOverride {
  return async (input) => unwrap(await attachEmissionLineFileFn({ creditBatchId: scope.creditBatchId, componentId, upload: input }));
}

function useLineFileMutation<TInput, TData>(scope: EmissionBatchScope, run: (input: TInput) => Promise<ActionResult<TData>>) {
  const queryClient = useQueryClient();
  return useMutation({
    meta: recordLockMeta(RECORD_LOCK_TOUCHES.emission, { onRefusalOnly: true }),
    mutationFn: async (input: TInput) => unwrap(await run(input)),
    // Refresh after failures too: a stale version means the set moved.
    onSettled: () => invalidateEmissionEntryReads(queryClient, scope),
  });
}

export function useRemoveEmissionLineFile(scope: EmissionBatchScope) {
  return useLineFileMutation(scope, removeEmissionLineFileFn);
}

export function useReplaceEmissionLineFiles(scope: EmissionBatchScope) {
  return useLineFileMutation(scope, replaceEmissionLineFilesFn);
}
