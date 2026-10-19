"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listOAuthGrantsFn, revokeOAuthGrantFn } from "@/fn/oauth";
import { getStaleVersionConflict, throwActionError } from "@/lib/stale-version";
import type { RevokeOAuthGrantInput } from "@/schemas/oauth";
import { unwrap } from "./types";

type ActionData<T> = T extends { success: true; data: infer Data } ? Data : never;
export type OAuthGrantListItem = ActionData<Awaited<ReturnType<typeof listOAuthGrantsFn>>>[number];

export const oauthGrantKeys = {
  all: ["oauth-grants"] as const,
  list: (organizationId: string) => [...oauthGrantKeys.all, "list", organizationId] as const,
};

export function useOAuthGrants(organizationId: string) {
  return useQuery({ queryKey: oauthGrantKeys.list(organizationId), queryFn: async () => unwrap(await listOAuthGrantsFn()) });
}

export function useRevokeOAuthGrant(organizationId: string) {
  const client = useQueryClient();
  const invalidate = () => { void client.invalidateQueries({ queryKey: oauthGrantKeys.list(organizationId) }); };
  return useMutation({
    mutationFn: async (input: RevokeOAuthGrantInput) => {
      const result = await revokeOAuthGrantFn(input);
      if (!result.success) throwActionError(result);
      return result.data;
    },
    onSuccess: invalidate,
    onError: error => { if (getStaleVersionConflict(error)) invalidate(); },
    retry: false,
  });
}
