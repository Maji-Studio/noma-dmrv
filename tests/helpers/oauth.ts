import { createHash, randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { members, oauthClients, oauthConsents, organizations, sessions, users } from "@/db/schema";
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
