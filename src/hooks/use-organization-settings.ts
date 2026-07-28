/**
 * Organization operating defaults.
 *
 * Two consumers with different needs. `/settings/defaults` edits them, so it
 * wants the payload including `viewerCanManage`. Every create form that seeds a
 * field from them wants only the values, and wants them cached long enough that
 * opening a form is not a round trip — these change a handful of times in an
 * organization's life, so the stale window is minutes, not seconds.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DEFAULT_ORGANIZATION_SETTINGS } from "@/config/organization-settings";
import {
  loadOrganizationDefaults,
  saveOrganizationDefaults,
} from "@/fn/organization-settings";
import type { OrganizationSettingsValues } from "@/schemas/organization-settings";
import { unwrap } from "@/hooks/types";

const ORGANIZATION_DEFAULTS_STALE_MS = 300_000;

export const organizationSettingsKeys = {
  all: ["organization-settings"] as const,
  defaults: () => [...organizationSettingsKeys.all, "defaults"] as const,
};

export function useOrganizationDefaults() {
  return useQuery({
    queryKey: organizationSettingsKeys.defaults(),
    queryFn: async () => unwrap(await loadOrganizationDefaults()),
    staleTime: ORGANIZATION_DEFAULTS_STALE_MS,
  });
}

/**
 * Just the values, with the system fallback while the query is in flight. Form
 * defaults must be synchronous — a form that mounts before the query lands
 * would otherwise seed empty and never reseed, because react-hook-form reads
 * `defaultValues` once.
 */
export function useOrganizationDefaultValues() {
  const { data, isLoading } = useOrganizationDefaults();
  return {
    defaults: data?.defaults ?? DEFAULT_ORGANIZATION_SETTINGS,
    isLoading,
  };
}

export function useSaveOrganizationDefaults() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: OrganizationSettingsValues) =>
      unwrap(await saveOrganizationDefaults(input)),
    onSuccess: (defaults) => {
      queryClient.setQueryData(organizationSettingsKeys.defaults(), {
        defaults,
        viewerCanManage: true,
      });
    },
  });
}
