/**
 * Project-emission React Query hooks (ADR 0005, Posture B).
 *
 * noma owns the LCA-transcription audit trail; none of these hooks talk to
 * Isometric. The drift panel uses `useProjectComponents` (in
 * `use-certification.ts` or co-located if it lands later) to fetch
 * `listComponents({ projectId, scope: 'PROJECT' })` and reconcile against
 * these rows client-side.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createProjectEmission,
  editProjectEmission,
  loadProjectEmissionDrift,
  loadProjectEmissionsForFacility,
  removeProjectEmission,
} from "@/fn/certification";
import type {
  CreateProjectEmissionInput,
  DeleteProjectEmissionInput,
  UpdateProjectEmissionInput,
} from "@/schemas/project-emissions";

const DEFAULT_STALE_MS = 30_000;

export const projectEmissionsKeys = {
  all: ["project-emissions"] as const,
  forFacility: (facilityId: string) =>
    [...projectEmissionsKeys.all, "facility", facilityId] as const,
  driftForFacility: (facilityId: string) =>
    [...projectEmissionsKeys.all, "drift", facilityId] as const,
};

export function useProjectEmissionDrift(facilityId: string, enabled = true) {
  return useQuery({
    queryKey: projectEmissionsKeys.driftForFacility(facilityId),
    queryFn: async () => {
      const result = await loadProjectEmissionDrift(facilityId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: enabled && !!facilityId,
    staleTime: DEFAULT_STALE_MS,
  });
}

export function useProjectEmissionsForFacility(
  facilityId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: projectEmissionsKeys.forFacility(facilityId),
    queryFn: async () => {
      const result = await loadProjectEmissionsForFacility(facilityId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: enabled && !!facilityId,
    staleTime: DEFAULT_STALE_MS,
  });
}

export function useCreateProjectEmission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateProjectEmissionInput) => {
      const result = await createProjectEmission(input);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: projectEmissionsKeys.forFacility(variables.facilityId),
      });
      queryClient.invalidateQueries({
        queryKey: projectEmissionsKeys.driftForFacility(variables.facilityId),
      });
    },
  });
}

export function useUpdateProjectEmission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateProjectEmissionInput) => {
      const result = await editProjectEmission(input);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: projectEmissionsKeys.forFacility(variables.facilityId),
      });
      queryClient.invalidateQueries({
        queryKey: projectEmissionsKeys.driftForFacility(variables.facilityId),
      });
    },
  });
}

export function useDeleteProjectEmission(facilityId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: DeleteProjectEmissionInput) => {
      const result = await removeProjectEmission(input);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: projectEmissionsKeys.forFacility(facilityId),
      });
      queryClient.invalidateQueries({
        queryKey: projectEmissionsKeys.driftForFacility(facilityId),
      });
    },
  });
}
