import { afterEach, beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { members, oauthGrants, organizationApiAccess, users } from "@/db/schema";
import { OAUTH_IDLE_LIMIT_MS } from "@/config/oauth";
import { assertGenerationEligible } from "@/lib/auth/oauth-eligibility";
import { revokeGeneration } from "@/data-access/oauth-grant-lifecycle";
import { createOAuthFixture, type OAuthFixture } from "./helpers/oauth";

let f: OAuthFixture;
beforeEach(async () => { f = await createOAuthFixture(); });
afterEach(async () => { await f.cleanup(); });
it("permits a live Member without an absolute lifetime", async () => {
  const { grant } = await f.accessToken({ createdAt: new Date(0) });
  expect(await assertGenerationEligible(grant, new Date())).toEqual({ ok: true, role: "member" });
});
it("checks membership before email and revocation, including re-admission", async () => {
  const { grant } = await f.accessToken();
  await revokeGeneration(grant.id, "disconnected");
  await db.update(users).set({ emailVerified: false }).where(eq(users.id, f.userId));
  await db.delete(members).where(eq(members.id, f.memberIds[0]));
  expect(await assertGenerationEligible(grant, new Date())).toEqual({ ok: false, denial: "credential_owner_removed" });
});
it("checks email before revoked state and lifetime", async () => {
  const { grant } = await f.accessToken({ lastUsedAt: new Date(0) });
  await revokeGeneration(grant.id, "disconnected");
  await db.update(users).set({ emailVerified: false }).where(eq(users.id, f.userId));
  expect(await assertGenerationEligible(grant, new Date())).toEqual({ ok: false, denial: "credential_owner_unverified" });
});
it("re-reads revocation rather than trusting the caller's snapshot", async () => {
  const { grant } = await f.accessToken();
  await revokeGeneration(grant.id, "disconnected");
  expect(await assertGenerationEligible(grant, new Date())).toEqual({ ok: false, denial: "credential_revoked" });
});
it("expires at the idle boundary, revokes before refusal and never updates activity", async () => {
  const { grant } = await f.accessToken();
  expect(await assertGenerationEligible(grant, new Date(grant.lastUsedAt.getTime() + OAUTH_IDLE_LIMIT_MS - 1))).toMatchObject({ ok: true });
  expect(await assertGenerationEligible(grant, new Date(grant.lastUsedAt.getTime() + OAUTH_IDLE_LIMIT_MS))).toEqual({ ok: false, denial: "credential_expired" });
  const row = await db.query.oauthGrants.findFirst({ where: eq(oauthGrants.id, grant.id) });
  expect(row).toMatchObject({ revocationReason: "inactive", lastUsedAt: grant.lastUsedAt });
});
it("denies organization API access after lifetime", async () => {
  const { grant } = await f.accessToken();
  await db.insert(organizationApiAccess).values({ organizationId: f.orgIds[0], enabled: false, changedByUserId: f.actorId });
  expect(await assertGenerationEligible(grant, new Date())).toEqual({ ok: false, denial: "api_access_disabled" });
});
