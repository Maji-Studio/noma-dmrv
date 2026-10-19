import { env } from "@/config/env";
import { findOAuthClient, findOAuthConsent, findOAuthCredential, touchOAuthGeneration } from "@/data-access/oauth-credential-auth";
import type { ApiContextResolution } from "./api-context";
import { assertGenerationEligible } from "./oauth-eligibility";
import { OAUTH_GRANTABLE_SCOPES, oauthRoleCeiling } from "./oauth-scopes";
import { hashOAuthAccessToken } from "./oauth-token-hash";

export async function resolveOAuthContext(token: string, audience: string): Promise<ApiContextResolution> {
  if (!env.OAUTH_PROVIDER_ENABLED) return { ok: false, denial: "credential_invalid" };
  const stored = await findOAuthCredential(await hashOAuthAccessToken(token));
  if (!stored || stored.token.confirmation !== null || !stored.grant || stored.token.clientId !== stored.grant.clientId || stored.token.userId !== stored.grant.userId) {
    return { ok: false, denial: "credential_invalid" };
  }
  const { grant, token: access } = stored;
  if (access.revoked) return { ok: false, denial: "credential_revoked" };
  const now = new Date();
  const eligibility = await assertGenerationEligible(grant, now);
  if (!eligibility.ok) return eligibility;
  if (access.expiresAt <= now) return { ok: false, denial: "credential_expired" };
  if (access.resources?.length !== 1 || access.resources[0] !== grant.resource || grant.resource !== audience) {
    return { ok: false, denial: "credential_audience_mismatch" };
  }
  const client = await findOAuthClient(grant.clientId);
  if (!client || client.disabled) return { ok: false, denial: "credential_disabled" };
  const consent = await findOAuthConsent(grant);
  if (!consent) return { ok: false, denial: "credential_revoked" };
  const ceiling = oauthRoleCeiling(eligibility.role);
  const scopes = [...OAUTH_GRANTABLE_SCOPES].filter(scope => access.scopes.includes(scope) && consent.scopes.includes(scope) && ceiling.has(scope));
  await touchOAuthGeneration(grant.id, now);
  return { ok: true, ctx: {
    organizationId: grant.organizationId, userId: grant.userId, orgRole: eligibility.role, isPlatformAdmin: false,
    credentialId: grant.id, scopes,
    principal: { kind: "oauth", userId: grant.userId, credentialId: grant.id, oauthClientId: grant.clientId },
    credential: { kind: "oauth", id: grant.id, name: client.name, expiresAt: access.expiresAt },
  } };
}
