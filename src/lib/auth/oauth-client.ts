"use client";

import type { ActionResult } from "@/types/actions";
import { authClient } from "./providers/better-auth-client";

export const OAUTH_RESTART_MESSAGE = "Start again from the app.";

/** The continuation URL, as an ActionResult so hooks can unwrap it. */
type OAuthRedirect = ActionResult<string>;

function redirectFrom(result: { data?: unknown; error?: unknown }): OAuthRedirect {
  const data = result.data as { url?: unknown } | null | undefined;
  if (!result.error && typeof data?.url === "string") return { success: true, data: data.url };
  return { success: false, error: OAUTH_RESTART_MESSAGE };
}

/** Resumes authorization after the organization picker. */
export async function continueOAuthAuthorization(oauthQuery: string): Promise<OAuthRedirect> {
  try {
    return redirectFrom(await authClient.oauth2.continue({ postLogin: true, oauth_query: oauthQuery }));
  } catch { return { success: false, error: OAUTH_RESTART_MESSAGE }; }
}

/** Posts the consent decision. `scope` is the space-separated set the person accepted. */
export async function submitOAuthConsent(input: { accept: boolean; scope?: string; oauthQuery: string }): Promise<OAuthRedirect> {
  try {
    return redirectFrom(await authClient.oauth2.consent({
      accept: input.accept, ...(input.scope === undefined ? {} : { scope: input.scope }), oauth_query: input.oauthQuery }));
  } catch { return { success: false, error: OAUTH_RESTART_MESSAGE }; }
}
