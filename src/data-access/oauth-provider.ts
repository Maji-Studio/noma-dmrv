import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { oauthAuthorizationAttempts, oauthClientResources, oauthClients, users } from "@/db/schema";

const PLATFORM_ADMIN_ROLE = "admin";

// org-scope-ok: session-authenticated authorization attempt; membership is revalidated by the lifecycle before issuance
export async function findOAuthAttempt(input: { attemptKey: string; sessionId: string; userId: string }) {
  // org-scope-ok: session-authenticated authorization attempt bound to session and user
  const [attempt] = await db.select().from(oauthAuthorizationAttempts).where(and(
    eq(oauthAuthorizationAttempts.attemptKey, input.attemptKey), eq(oauthAuthorizationAttempts.sessionId, input.sessionId),
    eq(oauthAuthorizationAttempts.userId, input.userId), gt(oauthAuthorizationAttempts.expiresAt, new Date()),
  ));
  return attempt;
}

// org-scope-ok: platform client registry
export async function findOAuthClientResources(clientId: string) {
  // org-scope-ok: platform client registry
  return db.select({ resource: oauthClientResources.resourceId }).from(oauthClientResources)
    .where(eq(oauthClientResources.clientId, clientId));
}

// org-scope-ok: platform client registry; only a Platform Admin may register OAuth clients
export async function isPlatformAdminUser(userId: string) {
  // org-scope-ok: platform client registry; only a Platform Admin may register OAuth clients
  const [user] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId));
  return user?.role === PLATFORM_ADMIN_ROLE;
}

// org-scope-ok: platform client registry
export async function findOAuthClientScopes(clientId: string) {
  // org-scope-ok: platform client registry
  const [client] = await db.select({ scopes: oauthClients.scopes }).from(oauthClients).where(eq(oauthClients.clientId, clientId));
  return client?.scopes ?? [];
}
