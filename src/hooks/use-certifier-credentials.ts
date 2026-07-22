import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getOrgCertifierCredentialsStatusFn,
  removeOrgCertifierCredentialsFn,
  setOrgCertifierCredentialsFn,
} from "@/fn/certifier-credentials";
import type { CertifierCredentialsFormInput } from "@/schemas/organizations";
import { certificationKeys } from "@/hooks/use-certification";
import { unwrap } from "@/hooks/types";

export const certifierCredentialKeys = {
  all: ["certifier-credentials"] as const,
  organization: (organizationId: string) =>
    [...certifierCredentialKeys.all, organizationId] as const,
};

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
      // Credentials gate every Isometric read: the mapping section caches an
      // `isConfigured: false` project catalog before credentials exist, so it
      // must refetch now or the credentials-then-link flow stays stale until a
      // full reload.
      queryClient.invalidateQueries({ queryKey: certificationKeys.all });
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
      queryClient.invalidateQueries({ queryKey: certificationKeys.all });
    },
  });
}
