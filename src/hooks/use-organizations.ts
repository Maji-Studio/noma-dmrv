/**
 * Organization React Query hooks — members, invitations, and the Platform
 * Admin org directory. Mutations invalidate the member/invitation lists.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  changeMemberRoleAction,
  createOrganizationAction,
  getActiveOrganizationProfile,
  inviteMemberAction,
  listInvitationsFn,
  listMembersFn,
  listOrganizationsFn,
  removeMemberAction,
  revokeInvitationAction,
  setActiveOrganizationAction,
} from "@/fn/organizations";
import { FACILITY_STORAGE_KEY } from "@/hooks/use-facility-context";
import { unwrap } from "@/hooks/types";

export const organizationKeys = {
  all: ["organizations"] as const,
  members: () => [...organizationKeys.all, "members"] as const,
  invitations: () => [...organizationKeys.all, "invitations"] as const,
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
    queryFn: () => getActiveOrganizationProfile(),
  });
}

export function useResetAfterOrgSwitch() {
  return function resetAfterOrgSwitch() {
    if (typeof window === "undefined") {
      return;
    }
    try {
      window.localStorage.removeItem(FACILITY_STORAGE_KEY);
    } finally {
      // localStorage can throw when storage is blocked; the switch already
      // succeeded server-side, so always land in the new workspace. A hard
      // load makes every server component, Better Auth store, and client
      // cache re-read the new context.
      window.location.assign("/dashboard");
    }
  };
}

export function useEnterOrganization() {
  const resetAfterOrgSwitch = useResetAfterOrgSwitch();

  return async function enterOrganization(organizationId: string) {
    const result = await setActiveOrganizationAction({ organizationId });
    if (result.success) {
      resetAfterOrgSwitch();
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
      ownerEmail: string;
    }) => unwrap(await createOrganizationAction(input)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.directory() });
    },
  });
}
