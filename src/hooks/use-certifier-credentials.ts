import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getOrgCertifierCredentialsStatusFn,
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

/**
 * Credential posture for an organization (never the secrets themselves).
 *
 * `enabled` exists because callers that only need the posture as a hint — the
 * certification-settings rail marks its Credentials category from it — resolve
 * the organization id asynchronously, and the underlying action rejects an
 * empty one. Defaults to true so callers that already gate their own mount are
 * unaffected.
 */
export function useOrgCertifierCredentialsStatus(
  organizationId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: certifierCredentialKeys.organization(organizationId),
    queryFn: async () =>
      unwrap(
        await getOrgCertifierCredentialsStatusFn({ organizationId }),
      ),
    enabled: enabled && !!organizationId,
    staleTime: 30000,
  });
}

/**
 * Save the organization's keys. Either half may be omitted to rotate the other
 * on its own — the settings form leaves an untouched masked field out of the
 * payload rather than sending its mask.
 */
export function useSetOrgCertifierCredentials(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<CertifierCredentialsFormInput>) =>
      unwrap(
        await setOrgCertifierCredentialsFn({ ...input, organizationId }),
      ),
    onSuccess: (result) => {
      queryClient.setQueryData(
        certifierCredentialKeys.organization(organizationId),
        result.status,
      );
      // Credentials gate every Isometric read: the mapping section caches an
      // `isConfigured: false` project catalog before credentials exist, so it
      // must refetch now or the credentials-then-link flow stays stale until a
      // full reload.
      queryClient.invalidateQueries({ queryKey: certificationKeys.all });
    },
  });
}

// There is no remove hook: the settings form replaces keys by typing over them,
// so un-configuring an organization is not a control any surface offers. The
// data-access `deleteCertifierCredentials` remains for test teardown and for
// whatever surface eventually needs it.
