import { defaultKeyHasher } from "@better-auth/api-key";
import { OAUTH_ACCESS_TOKEN_PREFIX, OAUTH_ACCESS_TOKEN_SECONDS } from "@/config/oauth";
import { MILLISECONDS_PER_SECOND } from "@/config/api-keys";
import { getOAuthConfig } from "@/lib/auth/oauth-config";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { members, oauthAccessTokens, oauthGrants, oauthClients, oauthConsents, organizations, sessions, users } from "@/db/schema";
import { makeTestOrgContext } from "./test-org";

export const OAUTH_TEST_RESOURCE = "http://localhost:3100/api/mcp";
export const OAUTH_TEST_DAY_MS = 86_400_000;
export async function createOAuthFixture() {
  const userId = `e2e-oauth-${randomUUID()}`;
  const actorId = `e2e-oauth-${randomUUID()}`;
  const orgIds = [randomUUID(), randomUUID()];
  const memberIds = [randomUUID(), randomUUID()];
  const sessionId = randomUUID();
  const clientId = `https://example.test/${randomUUID()}`;
  await db.insert(organizations).values(orgIds.map(id => ({ id, slug: id, name: "E2E OAuth organization" })));
  await db.insert(users).values([userId, actorId].map(id => ({ id, email: `${id}@e2e.local`, name: "E2E OAuth user", emailVerified: true })));
  await db.insert(members).values([
    ...orgIds.map((organizationId, i) => ({ id: memberIds[i], organizationId, userId, role: "member" })),
    { id: randomUUID(), organizationId: orgIds[0], userId: actorId, role: "owner" },
  ]);
  await db.insert(sessions).values({ id: sessionId, userId, token: randomUUID(), expiresAt: new Date(Date.now() + OAUTH_TEST_DAY_MS) });
  await db.insert(oauthClients).values({ id: randomUUID(), clientId, name: "E2E OAuth client", redirectUris: ["https://example.test/callback"] });
  return {
    userId, actorId, orgIds, memberIds, sessionId, clientId,
    ctx: { ...makeTestOrgContext(userId), organizationId: orgIds[0], orgRole: "member" as const },
    attempt(organizationId = orgIds[0]) {
      return { attemptKey: createHash("sha256").update(randomUUID()).digest("hex"), sessionId, userId, organizationId };
    },
    async accessToken(options: { resource?: string; scopes?: string[]; consentScopes?: string[]; organizationIndex?: number; organizationId?: string; memberId?: string; lastUsedAt?: Date; createdAt?: Date; expiresAt?: Date; confirmation?: unknown } = {}) {
      const now = new Date();
      const index = options.organizationIndex ?? 0;
      const resource = options.resource ?? getOAuthConfig().rest;
      const scopes = options.scopes ?? ["feedstocks:read", "feedstocks:write"];
      const organizationId = options.organizationId ?? orgIds[index];
      const memberId = options.memberId ?? memberIds[index];
      // One active generation per binding (c2's partial unique index): a second
      // token for the same binding reuses it and re-consents, like the plugin.
      const [active] = options.createdAt || options.lastUsedAt ? [] : await db.select().from(oauthGrants)
        .where(and(eq(oauthGrants.organizationId, organizationId), eq(oauthGrants.userId, userId), eq(oauthGrants.clientId, clientId),
          eq(oauthGrants.resource, resource), eq(oauthGrants.memberId, memberId), isNull(oauthGrants.revokedAt)));
      const [grant] = active ? [active] : await db.insert(oauthGrants).values({ id: randomUUID(), organizationId, userId,
        memberId, clientId, resource, createdAt: options.createdAt ?? now, lastUsedAt: options.lastUsedAt ?? now }).returning();
      await db.delete(oauthConsents).where(eq(oauthConsents.referenceId, grant.id));
      await db.insert(oauthConsents).values({ id: randomUUID(), clientId, userId, referenceId: grant.id,
        resources: [resource], scopes: options.consentScopes ?? scopes, createdAt: now, updatedAt: now });
      const body = randomUUID();
      const [token] = await db.insert(oauthAccessTokens).values({ id: randomUUID(), token: await defaultKeyHasher(body),
        clientId, userId, referenceId: grant.id, resources: [resource], scopes, createdAt: now,
        expiresAt: options.expiresAt ?? new Date(now.getTime() + OAUTH_ACCESS_TOKEN_SECONDS * MILLISECONDS_PER_SECOND),
        confirmation: options.confirmation ?? null }).returning();
      const bearer = `${OAUTH_ACCESS_TOKEN_PREFIX}${body}`;
      return { grant, token, request: (path = "/api/v1/me") => new Request(`${new URL(resource).origin}${path}`, { headers: { authorization: `Bearer ${bearer}` } }) };
    },
    async consent(grantId: string) {
      await db.insert(oauthConsents).values({ id: randomUUID(), clientId, userId, referenceId: grantId,
        scopes: ["feedstocks:read"], resources: [OAUTH_TEST_RESOURCE], createdAt: new Date(), updatedAt: new Date() });
    },
    async cleanup() {
      await db.delete(organizations).where(inArray(organizations.id, orgIds));
      await db.delete(oauthClients).where(eq(oauthClients.clientId, clientId));
      await db.delete(users).where(inArray(users.id, [userId, actorId]));
    },
  };
}
export type OAuthFixture = Awaited<ReturnType<typeof createOAuthFixture>>;

/** Build transport requests without exposing the fixture's bearer as a return value. */
export function oauthRequest(access: Awaited<ReturnType<OAuthFixture["accessToken"]>>, path: string, init: RequestInit = {}) {
  const request = access.request(path);
  const headers = new Headers(request.headers);
  new Headers(init.headers).forEach((value, name) => headers.set(name, value));
  return new Request(request, { ...init, headers });
}
export function oauthRpc(access: Awaited<ReturnType<OAuthFixture["accessToken"]>>, method: string, params: Record<string, unknown> = {}) {
  return oauthRequest(access, "/api/mcp", { method: "POST", headers: {
    "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18",
  }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
}
