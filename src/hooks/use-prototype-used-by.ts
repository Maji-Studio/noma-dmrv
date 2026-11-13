"use client";

/** PROTOTYPE ONLY (Used by section round). Delete with the prototype. */
import { useQuery } from "@tanstack/react-query";
import { getPrototypeUsedByFn } from "@/fn/prototype-used-by";
import type { PrototypeUsedByKind } from "@/lib/prototype-used-by";
import { unwrap } from "./types";

export function usePrototypeUsedBy(kind: PrototypeUsedByKind | null, id: string | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["prototype-used-by", kind, id],
    queryFn: async () => unwrap(await getPrototypeUsedByFn(kind!, id!)),
    enabled: enabled && !!kind && !!id,
  });
}
