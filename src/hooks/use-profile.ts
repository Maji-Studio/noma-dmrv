/**
 * Profile mutations for Settings, You, Profile. A refused password change
 * throws an `ActionError` whose issues name the field, for `useSaveRefusal`.
 */
"use client";

import { useMutation } from "@tanstack/react-query";
import { changePasswordFn, updateProfileNameFn } from "@/fn/profile";
import { unwrap } from "@/hooks/types";
import { refreshSession } from "@/lib/auth/client";
import type { ChangePasswordFormData, ProfileNameFormData } from "@/schemas/profile";

export function useUpdateProfileName() {
  return useMutation({
    mutationFn: async (input: ProfileNameFormData) => unwrap(await updateProfileNameFn(input)),
    // The sidebar reads the name from the client session store.
    onSuccess: () => refreshSession(),
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: async (input: ChangePasswordFormData) => unwrap(await changePasswordFn(input)),
  });
}
