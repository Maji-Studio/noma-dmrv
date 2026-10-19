"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { setEmissionLineCommentFn, deleteEmissionLineCommentFn } from "@/fn/emission-line-comments";
import { throwActionError } from "@/lib/stale-version";
import type { ActionResult } from "@/types/actions";
import { invalidateEmissionEntryReads, type EmissionBatchScope } from "./use-emission-entries";

function useLineCommentMutation<TInput, TData>(scope: EmissionBatchScope, run: (input: TInput) => Promise<ActionResult<TData>>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: TInput) => {
      const result = await run(input);
      if (!result.success) throwActionError(result);
      return result.data;
    },
    onSettled: () => invalidateEmissionEntryReads(queryClient, scope),
  });
}

export function useSetEmissionLineComment(scope: EmissionBatchScope) {
  return useLineCommentMutation(scope, setEmissionLineCommentFn);
}

export function useDeleteEmissionLineComment(scope: EmissionBatchScope) {
  return useLineCommentMutation(scope, deleteEmissionLineCommentFn);
}
