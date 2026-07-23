"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

export const feedstockTypeKeys = {
  all: ["feedstock-types"] as const,
  list: () => ["feedstock-types", "list"] as const,
};

export function useFeedstockTypeList(enabled = true) {
  return useQuery({
    queryKey: feedstockTypeKeys.list(),
    queryFn: async () => {
      const result = await listFeedstockTypesFn();
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled,
  });
}

function useInvalidateFeedstockTypes() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: feedstockTypeKeys.all });
    void queryClient.invalidateQueries({ queryKey: ["entities", "feedstockType"] });
  };
}

export function useCreateFeedstockType() {
  const invalidate = useInvalidateFeedstockTypes();
  return useMutation({
    mutationFn: async (input: CreateFeedstockTypeData) => {
      const result = await createFeedstockTypeFn(input);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: invalidate,
  });
}

export function useUpdateFeedstockType() {
  const invalidate = useInvalidateFeedstockTypes();
  return useMutation({
    mutationFn: async (input: UpdateFeedstockTypeData) => {
      const result = await updateFeedstockTypeFn(input);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: invalidate,
  });
}

export function useArchiveFeedstockType() {
  const invalidate = useInvalidateFeedstockTypes();
  return useMutation({
    mutationFn: async (feedstockTypeId: string) => {
      const result = await archiveFeedstockTypeFn({ feedstockTypeId });
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: invalidate,
  });
}

export function useUnarchiveFeedstockType() {
  const invalidate = useInvalidateFeedstockTypes();
  return useMutation({
    mutationFn: async (feedstockTypeId: string) => {
      const result = await unarchiveFeedstockTypeFn({ feedstockTypeId });
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: invalidate,
  });
}

export function useDeleteFeedstockType() {
  const invalidate = useInvalidateFeedstockTypes();
  return useMutation({
    mutationFn: async (feedstockTypeId: string) => {
      const result = await deleteFeedstockTypeFn({ feedstockTypeId });
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: invalidate,
  });
}

export function useImportIsometricFeedstockType() {
  const invalidate = useInvalidateFeedstockTypes();
  return useMutation({
    mutationFn: async (input: ImportIsometricFeedstockTypeData) => {
      const result = await importIsometricFeedstockTypeFn(input);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: invalidate,
  });
}
