/**
 * Profile mutations for Settings, You, Profile. A refused password change
 * throws an `ActionError` whose issues name the field, for `useSaveRefusal`.
 */
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { changeEmailFn, changePasswordFn, updateProfileNameFn } from "@/fn/profile";
import { unwrap } from "@/hooks/types";
import { invalidateOrgMembers } from "@/hooks/use-organizations";
import { refreshSession } from "@/lib/auth/client";
import type { ChangeEmailFormData, ChangePasswordFormData, ProfileNameFormData } from "@/schemas/profile";

export function useUpdateProfileName() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ProfileNameFormData) => unwrap(await updateProfileNameFn(input)),
    onSuccess: () => {
      // The sidebar reads the name from the client session store; Members
      // lists it from React Query.
      refreshSession();
      void invalidateOrgMembers(queryClient);
    },
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: async (input: ChangePasswordFormData) => unwrap(await changePasswordFn(input)),
  });
}

/**
 * Asks for a confirmation link at the new address. The address changes only
 * when that link is opened, so success is "link sent", never "changed". The
 * server answers the same for an address another account already holds.
 */
export function useChangeEmail() {
  return useMutation({
    mutationFn: async (input: ChangeEmailFormData) => unwrap(await changeEmailFn(input)),
  });
}
