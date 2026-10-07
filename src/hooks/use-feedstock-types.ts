"use client";

import { throwActionError, StaleVersionError } from "@/lib/stale-version";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { patchArrayListCacheWithSavedRow } from "./list-cache-utils";
import type { FeedstockType } from "@/db/schema";
import { entityKeys } from "./entity-query-keys";
import {
  archiveFeedstockTypeFn,
  createFeedstockTypeFn,
  deleteFeedstockTypeFn,
  importIsometricFeedstockTypeFn,
  listFeedstockTypesFn,
  unarchiveFeedstockTypeFn,
  updateFeedstockTypeFn,
} from "@/fn/feedstock-types";
import type {
  CreateFeedstockTypeData,
  ImportIsometricFeedstockTypeData,
  UpdateFeedstockTypeData,
} from "@/schemas/feedstock-types";
import { certificationKeys } from "./use-certification";

const feedstockTypeKeys = {
  all: ["feedstock-types"] as const,
  list: () => ["feedstock-types", "list"] as const,
};

export function useFeedstockTypeList(enabled = true) {
  return useQuery({
    queryKey: feedstockTypeKeys.list(),
    queryFn: async () => {
      const result = await listFeedstockTypesFn();
      if (!result.success) throwActionError(result);
      return result.data;
    },
    enabled,
  });
}

function useInvalidateFeedstockTypes() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: feedstockTypeKeys.all });
    void queryClient.invalidateQueries({ queryKey: certificationKeys.all });
    void queryClient.invalidateQueries({
      queryKey: entityKeys.listPrefix("feedstockType"),
    });
  };
}

export function useCreateFeedstockType() {
  const invalidate = useInvalidateFeedstockTypes();
  return useMutation({
    mutationFn: async (input: CreateFeedstockTypeData) => {
      const result = await createFeedstockTypeFn(input);
      if (!result.success) throwActionError(result);
      return result.data;
    },
    onSuccess: invalidate,
  });
}

export function useUpdateFeedstockType() {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateFeedstockTypes();
  return useMutation({
    mutationFn: async (input: UpdateFeedstockTypeData) => {
      const result = await updateFeedstockTypeFn(input);
      if (!result.success) throwActionError(result);
      return result.data;
    },
    onSuccess: (data) => {
      patchArrayListCacheWithSavedRow<FeedstockType>(queryClient, feedstockTypeKeys.list(), data);
      invalidate();
    },
  });
}

export function useArchiveFeedstockType() {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateFeedstockTypes();
  return useMutation({
    mutationFn: async (variables: { feedstockTypeId: string; expectedVersion: number }) => {
      const result = await archiveFeedstockTypeFn(variables);
      if (!result.success) throwActionError(result);
      return result.data;
    },
    onSuccess: (data) => {
      patchArrayListCacheWithSavedRow<FeedstockType>(queryClient, feedstockTypeKeys.list(), data);
      invalidate();
    },
    onError: (error) => { if (error instanceof StaleVersionError) invalidate(); },
  });
}

export function useUnarchiveFeedstockType() {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateFeedstockTypes();
  return useMutation({
    mutationFn: async (variables: { feedstockTypeId: string; expectedVersion: number }) => {
      const result = await unarchiveFeedstockTypeFn(variables);
      if (!result.success) throwActionError(result);
      return result.data;
    },
    onSuccess: (data) => {
      patchArrayListCacheWithSavedRow<FeedstockType>(queryClient, feedstockTypeKeys.list(), data);
      invalidate();
    },
    onError: (error) => { if (error instanceof StaleVersionError) invalidate(); },
  });
}

export function useDeleteFeedstockType() {
  const invalidate = useInvalidateFeedstockTypes();
  return useMutation({
    mutationFn: async (variables: { feedstockTypeId: string; expectedVersion: number }) => {
      const result = await deleteFeedstockTypeFn(variables);
      if (!result.success) throwActionError(result);
      return result.data;
    },
    onSuccess: invalidate,
    onError: (error) => { if (error instanceof StaleVersionError) invalidate(); },
  });
}

export function useImportIsometricFeedstockType() {
  const invalidate = useInvalidateFeedstockTypes();
  return useMutation({
    mutationFn: async (input: ImportIsometricFeedstockTypeData) => {
      const result = await importIsometricFeedstockTypeFn(input);
      if (!result.success) throwActionError(result);
      return result.data;
    },
    onSuccess: invalidate,
  });
}
