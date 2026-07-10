/**
 * Organization React Query hooks — members, invitations, and the Platform
 * Admin org directory. Mutations invalidate the member/invitation lists.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  changeMemberRoleAction,
  createOrganizationAction,
  inviteMemberAction,
  listInvitationsFn,
  listMembersFn,
  listOrganizationsFn,
  removeMemberAction,
  revokeInvitationAction,
  setActiveOrganizationAction,
} from "@/fn/organizations";
import { FACILITY_STORAGE_KEY } from "@/hooks/use-facility-context";
import type { ActionResult } from "@/types/actions";

export const organizationKeys = {
  all: ["organizations"] as const,
  members: () => [...organizationKeys.all, "members"] as const,
  invitations: () => [...organizationKeys.all, "invitations"] as const,
  directory: () => [...organizationKeys.all, "directory"] as const,
};

function unwrap<T>(result: ActionResult<T>): T {
  if (!result.success) {
    throw new Error(result.error);
  }
  return result.data;
}

export function useResetAfterOrgSwitch() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return function resetAfterOrgSwitch() {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(FACILITY_STORAGE_KEY);
    }
    queryClient.clear();
    router.replace("/dashboard");
    router.refresh();
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
