/**
 * Organization operating defaults.
 *
 * Two consumers with different needs. `/settings/defaults` edits them, so it
 * wants the payload including `viewerCanManage`. Every create form that seeds a
 * field from them wants only the values, and wants them **synchronously** —
 * react-hook-form reads `defaultValues` exactly once at mount, so a form that
 * opens before the values arrive captures the system fallback permanently and
 * silently creates a record with the wrong currency or trip type.
 *
 * That is why the `(app)` layout resolves them server-side and seeds this query
 * through `FacilityProvider`: with `initialData` the very first client render
 * already has the organization's values, so there is no window to lose. The
 * network query then only refreshes them. Warming the cache with a fetch was
 * not enough — a hard load straight onto `/deliveries?create=true` mounts the
 * form in the same tick the fetch starts.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DEFAULT_ORGANIZATION_SETTINGS } from "@/config/organization-settings";
import {
  loadOrganizationDefaults,
  saveOrganizationDefaults,
  type OrganizationDefaultsPayload,
} from "@/fn/organization-settings";
import type { OrganizationSettingsValues } from "@/schemas/organization-settings";
import { unwrap } from "@/hooks/types";

const ORGANIZATION_DEFAULTS_STALE_MS = 300_000;

export const organizationSettingsKeys = {
  all: ["organization-settings"] as const,
  defaults: () => [...organizationSettingsKeys.all, "defaults"] as const,
};

/**
 * `initialData` is passed only by `FacilityProvider`, from the server-resolved
 * payload. Every other caller reads the cache entry that seeded.
 */
export function useOrganizationDefaults(
  initialData?: OrganizationDefaultsPayload,
) {
  return useQuery({
    queryKey: organizationSettingsKeys.defaults(),
    queryFn: async () => unwrap(await loadOrganizationDefaults()),
    staleTime: ORGANIZATION_DEFAULTS_STALE_MS,
    initialData,
  });
}

/**
 * Just the values. Falls back to the system defaults only when there is no
 * server-seeded entry and no response yet — which, with the layout seeding in
 * place, means the user has no active organization at all.
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
