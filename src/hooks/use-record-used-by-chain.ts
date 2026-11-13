"use client";

import { useQuery } from "@tanstack/react-query";
import { getRecordUsedByChainRead } from "@/lib/read-api/client";
import type { RecordUsedByKind } from "@/lib/record-used-by-chain";
import { recordLockKeys } from "./record-lock-query-keys";
import { unwrap } from "./types";

export function useRecordUsedByChain(kind: RecordUsedByKind | null | undefined, id: string | null | undefined, enabled = true) {
  const canonicalId = id?.toLowerCase();
  return useQuery({
    queryKey: recordLockKeys.usedByChain(kind, canonicalId),
    queryFn: async ({ signal }) => {
      if (!kind || !canonicalId) throw new Error("A record kind and id are required.");
      return unwrap(await getRecordUsedByChainRead({ kind, id: canonicalId }, { signal }));
    },
    enabled: enabled && !!kind && !!canonicalId,
  });
}
