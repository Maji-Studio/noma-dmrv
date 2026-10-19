"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { getOAuthConsentViewFn, getOAuthOrganizationChoicesFn, selectOAuthOrganizationFn } from "@/fn/oauth";
import { continueOAuthAuthorization, submitOAuthConsent } from "@/lib/auth/oauth-client";
import { unwrap } from "./types";

type ActionData<T> = T extends { success: true; data: infer Data } ? Data : never;
export type OAuthOrganizationChoices = ActionData<Awaited<ReturnType<typeof getOAuthOrganizationChoicesFn>>>;
export type OAuthConsentView = ActionData<Awaited<ReturnType<typeof getOAuthConsentViewFn>>>;

export const oauthFlowKeys = {
  all: ["oauth-flow"] as const,
  organizations: (oauthQuery: string) => [...oauthFlowKeys.all, "organizations", oauthQuery] as const,
  consent: (oauthQuery: string) => [...oauthFlowKeys.all, "consent", oauthQuery] as const,
};

// A signed query is single-purpose: never reuse a cached read after a failure or a mutation.
const FLOW_QUERY = { staleTime: 0, retry: false, refetchOnMount: "always", refetchOnWindowFocus: false } as const;

/** The query is `null` until the client has read it, and the read waits for it. */
export function useOAuthOrganizationChoices(oauthQuery: string | null) {
  return useQuery({ ...FLOW_QUERY, enabled: !!oauthQuery, queryKey: oauthFlowKeys.organizations(oauthQuery ?? ""),
    queryFn: async () => unwrap(await getOAuthOrganizationChoicesFn({ oauthQuery })) });
}

export function useOAuthConsentView(oauthQuery: string | null) {
  return useQuery({ ...FLOW_QUERY, enabled: !!oauthQuery, queryKey: oauthFlowKeys.consent(oauthQuery ?? ""),
    queryFn: async () => unwrap(await getOAuthConsentViewFn({ oauthQuery })) });
}

/** Records the organization for this attempt, then resumes authorization. Resolves to the continuation URL. */
export function useSelectOAuthOrganization(oauthQuery: string) {
  return useMutation({
    mutationFn: async (organizationId: string) => {
      const selected = unwrap(await selectOAuthOrganizationFn({ oauthQuery, organizationId }));
      return unwrap(await continueOAuthAuthorization(selected.oauth_query));
    },
    retry: false,
  });
}

export function useOAuthConsentDecision(oauthQuery: string) {
  return useMutation({
    mutationFn: async (input: { accept: boolean; scope?: string }) => {
      return unwrap(await submitOAuthConsent({ ...input, oauthQuery }));
    },
    retry: false,
  });
}
