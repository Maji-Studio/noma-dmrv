import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import { db } from "@/db";
import { apiKeys, apiKeyOwners, oauthAccessTokens, oauthConsents, oauthGrants, oauthRefreshTokens } from "@/db/schema";
import { revokeUserOAuthGrants } from "@/data-access/oauth-grant-lifecycle";
import { listActiveAccountApiKeys } from "@/data-access/account-api-keys";
import { createOAuthFixture, OAUTH_TEST_DAY_MS, type OAuthFixture } from "./helpers/oauth";

let a: OAuthFixture;
let b: OAuthFixture;
beforeEach(async () => { a = await createOAuthFixture(); b = await createOAuthFixture(); });
afterEach(async () => { await b?.cleanup(); await a?.cleanup(); });

it("revokes all of A's grants and consents across organizations without affecting B or API keys", async () => {
  const first = await a.accessToken();
  const second = await a.accessToken({ organizationIndex: 1 });
  const other = await b.accessToken();
  const now = new Date();
  for (const [fixture, grant] of [[a, first.grant], [a, second.grant], [b, other.grant]] as const) {
    await db.insert(oauthRefreshTokens).values({ id: randomUUID(), token: randomUUID(), clientId: fixture.clientId,
      userId: fixture.userId, referenceId: grant.id, scopes: ["feedstocks:read"], createdAt: now,
      expiresAt: new Date(now.getTime() + OAUTH_TEST_DAY_MS) });
  }
  const keyId = randomUUID();
  await db.insert(apiKeys).values({ id: keyId, key: randomUUID(), referenceId: a.orgIds[0], name: "E2E automation", createdAt: now });
  await db.insert(apiKeyOwners).values({ credentialId: keyId, userId: a.userId, organizationId: a.orgIds[0], memberId: a.memberIds[0] });
  const keysBefore = await db.select().from(apiKeys).where(eq(apiKeys.id, keyId));
  await revokeUserOAuthGrants(a.userId);
  await revokeUserOAuthGrants(a.userId); // Safe retry does not bump revoked generations again.
  const grants = await db.select().from(oauthGrants).where(inArray(oauthGrants.id, [first.grant.id, second.grant.id]));
  expect(grants).toHaveLength(2);
  for (const grant of grants) expect(grant).toMatchObject({ revokedAt: expect.any(Date), revocationReason: "disconnected", version: 2 });
  // Token rows stay until purge, as for any application revocation; their generation is revoked.
  expect(await db.select().from(oauthAccessTokens).where(eq(oauthAccessTokens.userId, a.userId))).toHaveLength(2);
  expect(await db.select().from(oauthRefreshTokens).where(eq(oauthRefreshTokens.userId, a.userId))).toHaveLength(2);
  expect(await db.select().from(oauthConsents).where(eq(oauthConsents.userId, a.userId))).toEqual([]);
  expect(await db.select().from(oauthGrants).where(eq(oauthGrants.id, other.grant.id))).toEqual([other.grant]);
  expect(await db.select().from(oauthAccessTokens).where(eq(oauthAccessTokens.userId, b.userId))).toEqual([other.token]);
  expect(await db.select().from(oauthRefreshTokens).where(eq(oauthRefreshTokens.userId, b.userId))).toHaveLength(1);
  expect(await db.select().from(oauthConsents).where(eq(oauthConsents.userId, b.userId))).toHaveLength(1);
  expect(await db.select().from(apiKeys).where(eq(apiKeys.id, keyId))).toEqual(keysBefore);
  expect(await listActiveAccountApiKeys(a.userId)).toEqual([{ name: "E2E automation", createdAt: now }]);
  expect(await listActiveAccountApiKeys(b.userId)).toEqual([]);
});
