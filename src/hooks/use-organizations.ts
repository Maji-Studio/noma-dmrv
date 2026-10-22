/**
 * Organization React Query hooks — members, invitations, and the Platform
 * Admin org directory. Mutations invalidate the member/invitation lists.
 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  changeMemberRoleAction,
  createOrganizationAction,
  inviteMemberAction,
  listInvitationsFn,
  listMembersFn,
  listOrganizationsFn,
  removeMemberAction,
  renameOrganizationAction,
  revokeInvitationAction,
  setActiveOrganizationAction,
} from "@/fn/organizations";
import { listOrganizationApiAccessFn, setOrganizationApiAccessFn } from "@/fn/organization-api-access";
import { getActiveOrganizationRead } from "@/lib/read-api/client";
import { FACILITY_STORAGE_KEY } from "@/hooks/use-facility-context";
import { authClient } from "@/lib/auth/client";
import type { RenameOrganizationInput } from "@/schemas/organizations";
import { unwrap } from "@/hooks/types";
import { NO_ORGANIZATION_MESSAGE } from "@/lib/errors";
import { stashPendingWarning } from "@/lib/pending-warning";
import { suppressUnloadWarning } from "@/lib/leave-guard";
import { stashOrgSwitchNotice, type OrgSwitchTarget } from "@/lib/org-switch-notice";

// How many times the active-organization read is re-attempted after a
// transport or server fault before the sidebar settles on an error. A
// no-organization answer never spends one; it is refused outright below.
const ACTIVE_ORGANIZATION_MAX_RETRIES = 3;

const organizationKeys = {
  all: ["organizations"] as const,
  members: () => [...organizationKeys.all, "members"] as const,
  invitations: () => [...organizationKeys.all, "invitations"] as const,
  apiAccess: () => [...organizationKeys.all, "api-access"] as const,
  directory: () => [...organizationKeys.all, "directory"] as const,
  activeProfile: () => [...organizationKeys.all, "active-profile"] as const,
};

/**
 * The active org's profile via our own override-aware server helper. The
 * plugin's useActiveOrganization() resolves through a members-only endpoint,
 * so it stays empty for Platform Admins inside an org they don't belong to.
 */
export function useActiveOrganizationProfile() {
  return useQuery({
    queryKey: organizationKeys.activeProfile(),
    queryFn: async ({ signal }) => unwrap(await getActiveOrganizationRead({ signal })),
    // A denied context answers the same on every attempt; transient transport
    // and server faults still retry so one blip does not settle the sidebar.
    retry: (failureCount, error) =>
      !(error instanceof Error && error.message === NO_ORGANIZATION_MESSAGE) &&
      failureCount < ACTIVE_ORGANIZATION_MAX_RETRIES,
  });
}

/** Refetch the member list, for a change made elsewhere (a member renaming themselves). */
export function invalidateOrgMembers(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: organizationKeys.members() });
}

export function useResetAfterOrgSwitch() {
  /**
   * `warning` is a non-fatal outcome of the switch itself (the "remember my
   * organization" preference was not saved). The reload below discards any
   * toast raised here, so it is handed to the page the operator lands on. The
   * "Now working in <org>" confirmation travels the same way; the name is
   * optional because an accepted invitation does not know it.
   */
  return function resetAfterOrgSwitch(warning?: string, target?: OrgSwitchTarget) {
    if (typeof window === "undefined") {
      return;
    }
    stashPendingWarning(warning);
    stashOrgSwitchNotice(target);
    try {
      window.localStorage.removeItem(FACILITY_STORAGE_KEY);
    } catch {
      // localStorage can throw when storage is blocked; the switch already
      // succeeded server-side, so swallow it and still land in the new
      // organization.
    }
    // The operator already chose to switch (and discarded any unsaved edits);
    // the browser's own "Leave site?" would ask again, and Stay would strand
    // the page in the old organization with the session in the new one.
    suppressUnloadWarning();
    // A hard load makes every server component, Better Auth store, and client
    // cache re-read the new context.
    window.location.assign("/dashboard");
  };
}

export function useEnterOrganization() {
  const resetAfterOrgSwitch = useResetAfterOrgSwitch();

  return async function enterOrganization(organizationId: string, organizationName?: string) {
    const result = await setActiveOrganizationAction({ organizationId });
    // Success means the server session moved, whether or not the "remember my
    // organization" preference was saved with it. Always reset, or the client
    // sits in the old organization while the session is in the new one
    // (issue #769). A `warning` on the result is the preference, not the
    // switch.
    if (result.success) {
      resetAfterOrgSwitch(result.warning, { organizationId, organizationName });
    }
    return result;
  };
}

export function useOrgMembers(enabled = true) {
  return useQuery({
    queryKey: organizationKeys.members(),
    queryFn: async () => unwrap(await listMembersFn()),
    enabled,
    staleTime: 15000,
  });
}

export function useOrgInvitations(enabled = true) {
  return useQuery({
    queryKey: organizationKeys.invitations(),
    queryFn: async () => unwrap(await listInvitationsFn()),
    enabled,
    staleTime: 15000,
  });
}

export function useAllOrganizations(enabled = true) {
  return useQuery({
    queryKey: organizationKeys.directory(),
    queryFn: async () => unwrap(await listOrganizationsFn()),
    enabled,
    staleTime: 30000,
  });
}

export function useAllOrganizationApiAccess(enabled = true) {
  return useQuery({
    queryKey: organizationKeys.apiAccess(),
    queryFn: async () => unwrap(await listOrganizationApiAccessFn()),
    enabled,
  });
}

export function useSetOrganizationApiAccess() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; enabled: boolean }) =>
      unwrap(await setOrganizationApiAccessFn(input)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: organizationKeys.apiAccess() }),
  });
}

export function useInviteMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { email: string; role: string }) =>
      unwrap(await inviteMemberAction(input)),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: organizationKeys.invitations(),
      });
    },
  });
}

export function useRevokeInvitation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (invitationId: string) =>
      unwrap(await revokeInvitationAction({ invitationId })),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: organizationKeys.invitations(),
      });
    },
  });
}

export function useChangeMemberRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { memberId: string; role: string }) =>
      unwrap(await changeMemberRoleAction(input)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.members() });
    },
  });
}

export function useRemoveMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (memberIdOrEmail: string) =>
      unwrap(await removeMemberAction({ memberIdOrEmail })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.members() });
    },
  });
}

export function useCreateOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      name: string;
      slug: string;
      adminEmail: string;
    }) => unwrap(await createOrganizationAction(input)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.directory() });
      queryClient.invalidateQueries({ queryKey: organizationKeys.apiAccess() });
    },
  });
}

export function useRenameOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: RenameOrganizationInput) =>
      unwrap(await renameOrganizationAction(input)),
    onSuccess: () => {
      authClient.$store.notify("$listOrg");
      return queryClient.invalidateQueries({ queryKey: organizationKeys.all });
    },
  });
}
