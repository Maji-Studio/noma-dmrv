"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createApiKeyFn, listApiKeysFn, revokeApiKeyFn, updateApiKeyFn } from "@/fn/api-keys";
import { getStaleVersionConflict, throwActionError } from "@/lib/stale-version";
import type { CreateApiKeyInput, RevokeApiKeyInput, UpdateApiKeyInput } from "@/schemas/api-keys";
type ActionData<T> = T extends { success: true; data: infer Data } ? Data : never;
export type ApiKeyListItem = ActionData<Awaited<ReturnType<typeof listApiKeysFn>>>[number];
type CreatedApiKey = ActionData<Awaited<ReturnType<typeof createApiKeyFn>>>;

export const apiKeyKeys = {
  all: ["api-keys"] as const,
  list: (organizationId: string) => [...apiKeyKeys.all, "list", organizationId] as const,
};

export function useApiKeys(organizationId: string) {
  return useQuery({
    queryKey: apiKeyKeys.list(organizationId),
    queryFn: async () => {
      const result = await listApiKeysFn();
      if (!result.success) throwActionError(result);
      return result.data;
    },
  });
}

/** Plaintext goes directly to local UI state, never into mutation data. */
export function useCreateApiKey(organizationId: string, onCreated: (key: CreatedApiKey) => void) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateApiKeyInput) => {
      const result = await createApiKeyFn(input);
      if (!result.success) throwActionError(result);
      onCreated(result.data);
      return { id: result.data.id };
    },
    onSuccess: () => { void client.invalidateQueries({ queryKey: apiKeyKeys.list(organizationId) }); },
    retry: false,
  });
}

export function useUpdateApiKey(organizationId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateApiKeyInput) => {
      const result = await updateApiKeyFn(input);
      if (!result.success) throwActionError(result);
      return result.data;
    },
    onError: (error) => {
      if (getStaleVersionConflict(error)) void client.invalidateQueries({ queryKey: apiKeyKeys.list(organizationId) });
    },
    onSuccess: () => { void client.invalidateQueries({ queryKey: apiKeyKeys.list(organizationId) }); },
  });
}

export function useRevokeApiKey(organizationId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: RevokeApiKeyInput) => {
      const result = await revokeApiKeyFn(input);
      if (!result.success) throwActionError(result);
      return result.data;
    },
    onError: (error) => {
      if (getStaleVersionConflict(error)) void client.invalidateQueries({ queryKey: apiKeyKeys.list(organizationId) });
    },
    onSuccess: () => { void client.invalidateQueries({ queryKey: apiKeyKeys.list(organizationId) }); },
  });
}
