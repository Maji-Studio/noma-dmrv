import { and, eq, isNull, lt } from "drizzle-orm";
import { db } from "@/db";
import { members, oauthAccessTokens, oauthClients, oauthConsents, oauthGrants, organizationApiAccess, users } from "@/db/schema";
import { OAUTH_LAST_USED_THROTTLE_MS } from "@/config/oauth";

// org-scope-ok: pre-authentication token lookup establishes the grant organization
export async function findOAuthCredential(tokenHash: string) {
  // org-scope-ok: pre-authentication token lookup establishes the grant organization
  const [row] = await db.select({ token: oauthAccessTokens, grant: oauthGrants }).from(oauthAccessTokens)
    .leftJoin(oauthGrants, eq(oauthGrants.id, oauthAccessTokens.referenceId))
    .where(eq(oauthAccessTokens.token, tokenHash));
  return row;
}

// org-scope-ok: pre-authentication token lookup establishes the grant organization
export async function findOAuthGenerationEligibility(id: string) {
  // org-scope-ok: pre-authentication token lookup establishes the grant organization
  const [row] = await db.select({ grant: oauthGrants, member: { id: members.id, role: members.role },
    emailVerified: users.emailVerified, apiEnabled: organizationApiAccess.enabled }).from(oauthGrants)
    .leftJoin(members, and(eq(members.organizationId, oauthGrants.organizationId), eq(members.userId, oauthGrants.userId)))
    .leftJoin(users, eq(users.id, oauthGrants.userId))
    .leftJoin(organizationApiAccess, eq(organizationApiAccess.organizationId, oauthGrants.organizationId))
    .where(eq(oauthGrants.id, id));
  return row;
}

// org-scope-ok: pre-authentication token lookup establishes the grant organization
export async function findOAuthConsent(grant: { id: string; clientId: string; userId: string }) {
  // org-scope-ok: pre-authentication token lookup establishes the grant organization
  const [row] = await db.select({ scopes: oauthConsents.scopes }).from(oauthConsents)
    .where(and(eq(oauthConsents.referenceId, grant.id), eq(oauthConsents.clientId, grant.clientId), eq(oauthConsents.userId, grant.userId)));
  return row;
}

// org-scope-ok: platform client registry
export async function findOAuthClient(clientId: string) {
  // org-scope-ok: platform client registry
  const [row] = await db.select({ name: oauthClients.name, disabled: oauthClients.disabled }).from(oauthClients)
    .where(eq(oauthClients.clientId, clientId));
  return row;
}

// org-scope-ok: pre-authentication token lookup establishes the grant organization
export async function touchOAuthGeneration(id: string, now: Date) {
  // org-scope-ok: pre-authentication token lookup establishes the grant organization
  return db.update(oauthGrants).set({ lastUsedAt: now })
    .where(and(eq(oauthGrants.id, id), isNull(oauthGrants.revokedAt), lt(oauthGrants.lastUsedAt, new Date(now.getTime() - OAUTH_LAST_USED_THROTTLE_MS))))
    .returning({ id: oauthGrants.id });
}
