/**
 * Certification React Query hooks
 * Manages the facility ↔ Isometric project mapping.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteFacilityCertifierMapping,
  loadFacilityCertifierMapping,
  loadIsometricProjectTemplates,
  saveFacilityCertifierMapping,
} from "@/fn/certification";
import type { SaveMappingInput } from "@/schemas/certification";

export const certificationKeys = {
  all: ["certification"] as const,
  facilityMapping: (facilityId: string) =>
    [...certificationKeys.all, "facility-mapping", facilityId] as const,
  projectTemplates: (externalProjectId: string) =>
    [...certificationKeys.all, "project-templates", externalProjectId] as const,
};

export function useFacilityCertifierMapping(
  facilityId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: certificationKeys.facilityMapping(facilityId),
    queryFn: async () => {
      const result = await loadFacilityCertifierMapping(facilityId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: enabled && !!facilityId,
    staleTime: 30_000,
  });
}

export function useIsometricProjectTemplates(externalProjectId: string | null) {
  return useQuery({
    queryKey: externalProjectId
      ? certificationKeys.projectTemplates(externalProjectId)
      : ["certification", "project-templates", "none"],
    queryFn: async () => {
      if (!externalProjectId) return [];
      const result = await loadIsometricProjectTemplates(externalProjectId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!externalProjectId,
    staleTime: 60_000,
  });
}

export function useSaveFacilityCertifierMapping() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SaveMappingInput) => {
      const result = await saveFacilityCertifierMapping(input);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: certificationKeys.facilityMapping(variables.facilityId),
      });
      queryClient.invalidateQueries({ queryKey: certificationKeys.all });
    },
  });
}

export function useDeleteFacilityCertifierMapping() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (facilityId: string) => {
      const result = await deleteFacilityCertifierMapping(facilityId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (_data, facilityId) => {
      queryClient.invalidateQueries({
        queryKey: certificationKeys.facilityMapping(facilityId),
      });
      queryClient.invalidateQueries({ queryKey: certificationKeys.all });
    },
  });
}
