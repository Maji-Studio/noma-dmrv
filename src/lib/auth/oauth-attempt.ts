import { createHash } from "node:crypto";
import { getOAuthProviderState } from "@better-auth/oauth-provider";
import { APIError } from "better-auth/api";
import { findOAuthAttempt, findOAuthClientResources } from "@/data-access/oauth-provider";
import { getOAuthOrganizationSelection, resolveAttemptGrant, selectOAuthOrganization } from "@/data-access/oauth-grant-lifecycle";
import { assertGenerationEligible } from "./oauth-eligibility";
import { parseOAuthScopes } from "./oauth-scopes";
import { getOAuthConfig } from "./oauth-config";

/** The caller must obtain query from verified provider state or verifyOAuthQueryParams. */
export function oauthAttemptKey(sessionId: string, query: URLSearchParams, resource: string) {
  return createHash("sha256").update(JSON.stringify([
    sessionId, query.get("client_id"), query.get("code_challenge"), resource, query.get("redirect_uri"),
  ])).digest("hex");
}

type Identity = { user: { id: string }; session: { id: string } };
function accessDenied(): never { throw new APIError("BAD_REQUEST", { error: "access_denied", error_description: "Start again from the app." }); }

async function currentAttempt({ user, session }: Identity) {
  // 1.7.10 sets this at authorize and verifies oauth_query before consent/continue.
  const state = await getOAuthProviderState();
  if (!state?.query) accessDenied();
  const query = new URLSearchParams(state.query);
  const clientId = query.get("client_id");
  if (!clientId || !query.get("code_challenge") || !query.get("redirect_uri")) accessDenied();
  const requested = query.getAll("resource");
  const resources = requested.length ? requested : (await findOAuthClientResources(clientId)).map(row => row.resource);
  const config = getOAuthConfig();
  if (resources.length !== 1 || ![config.rest, config.mcp].includes(resources[0])) accessDenied();
  const resource = resources[0];
  return { attemptKey: oauthAttemptKey(session.id, query, resource), sessionId: session.id, userId: user.id, clientId, resource };
}

export async function shouldRedirectOAuth(input: Identity): Promise<boolean> {
  try {
    const attempt = await currentAttempt(input);
    const existing = await findOAuthAttempt(attempt);
    const selection = await getOAuthOrganizationSelection(attempt);
    if (existing) {
      if (!selection.memberships.some(member => member.memberId === existing.memberId && member.organizationId === existing.organizationId)) accessDenied();
      return false;
    }
    if (!selection.autoSelectOrganizationId) return true;
    await selectOAuthOrganization({ ...attempt, organizationId: selection.autoSelectOrganizationId });
    return false;
  } catch { accessDenied(); }
}

export async function oauthConsentReferenceId(input: Identity & { scopes: string[] }): Promise<string> {
  try {
    if (!parseOAuthScopes(input.scopes.join(" ")).some(scope => scope !== "offline_access")) accessDenied();
    const grant = await resolveAttemptGrant(await currentAttempt(input));
    if (!(await assertGenerationEligible(grant, new Date())).ok) accessDenied();
    return grant.id;
  } catch { accessDenied(); }
}
