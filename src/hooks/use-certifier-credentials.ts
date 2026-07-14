import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getOrgCertifierCredentialsStatusFn,
  removeOrgCertifierCredentialsFn,
  setOrgCertifierCredentialsFn,
} from "@/fn/certifier-credentials";
import type { CertifierCredentialsFormInput } from "@/schemas/organizations";
import type { ActionResult } from "@/types/actions";

export const certifierCredentialKeys = {
  all: ["certifier-credentials"] as const,
  organization: (organizationId: string) =>
    [...certifierCredentialKeys.all, organizationId] as const,
};

function unwrap<T>(result: ActionResult<T>): T {
  if (!result.success) throw new Error(result.error);
  return result.data;
}

export function useOrgCertifierCredentialsStatus(organizationId: string) {
  return useQuery({
    queryKey: certifierCredentialKeys.organization(organizationId),
    queryFn: async () =>
      unwrap(
        await getOrgCertifierCredentialsStatusFn({ organizationId }),
      ),
    staleTime: 30000,
  });
}

export function useSetOrgCertifierCredentials(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CertifierCredentialsFormInput) =>
      unwrap(
        await setOrgCertifierCredentialsFn({ ...input, organizationId }),
      ),
    onSuccess: (status) => {
      queryClient.setQueryData(
        certifierCredentialKeys.organization(organizationId),
        status,
      );
    },
  });
}

export function useRemoveOrgCertifierCredentials(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      unwrap(await removeOrgCertifierCredentialsFn({ organizationId })),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: certifierCredentialKeys.organization(organizationId),
      });
    },
  });
}
