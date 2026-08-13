import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  loadApplicationStorageLocationSync,
  syncApplicationStorageLocation,
} from "@/fn/certification";

const storageLocationSyncKeys = {
  all: ["certification", "storage-location-sync"] as const,
  application: (applicationId: string) =>
    [...storageLocationSyncKeys.all, applicationId] as const,
};

export function useApplicationStorageLocationSync(applicationId: string) {
  return useQuery({
    queryKey: storageLocationSyncKeys.application(applicationId),
    queryFn: async () => {
      const result = await loadApplicationStorageLocationSync(applicationId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: Boolean(applicationId),
    staleTime: 30_000,
  });
}

export function useSyncApplicationStorageLocation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (applicationId: string) => {
      const result = await syncApplicationStorageLocation(applicationId);
      if (!result.success) throw new Error(result.error);
      return { applicationId, view: result.data };
    },
    onSuccess: ({ applicationId, view }) => {
      queryClient.setQueryData(
        storageLocationSyncKeys.application(applicationId),
        view,
      );
    },
  });
}
