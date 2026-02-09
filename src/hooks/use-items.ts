import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createItemFn,
  updateItemFn,
  archiveItemFn,
  getProjectItems,
} from "@/fn/items";

/**
 * Query hook for fetching project items
 */
export function useProjectItems(projectId: string) {
  return useQuery({
    queryKey: ["items", projectId],
    queryFn: async () => {
      const result = await getProjectItems(projectId);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    staleTime: 30000, // 30 seconds
  });
}

/**
 * Mutation hook for creating an item
 */
export function useCreateItem(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { title: string; description?: string }) =>
      createItemFn({ projectId, ...data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["items", projectId] });
    },
  });
}

/**
 * Mutation hook for updating an item
 */
export function useUpdateItem(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      itemId: string;
      title?: string;
      description?: string;
      status?: "active" | "archived";
    }) => updateItemFn(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["items", projectId] });
    },
  });
}

/**
 * Mutation hook for archiving an item
 */
export function useArchiveItem(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (itemId: string) => archiveItemFn(itemId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["items", projectId] });
    },
  });
}
