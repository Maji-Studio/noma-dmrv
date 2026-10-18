import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { members } from "@/db/schema";
import { afterEach, beforeEach, expect, it } from "vitest";
import { listOwnOAuthGrants, listAllOAuthGrants, revokeOAuthGrant } from "@/data-access/oauth-grants";
import { resolveAttemptGrant, selectOAuthOrganization } from "@/data-access/oauth-grant-lifecycle";
import { createOAuthFixture, OAUTH_TEST_RESOURCE, type OAuthFixture } from "./helpers/oauth";
let f: OAuthFixture;
beforeEach(async () => { f = await createOAuthFixture(); });
afterEach(async () => { await f?.cleanup(); });

it("scopes lists and versioned revocation by live membership, organization and owner", async () => {
  const attempt = f.attempt();
  await selectOAuthOrganization(attempt);
  const grant = await resolveAttemptGrant({ ...attempt, clientId: f.clientId, resource: OAUTH_TEST_RESOURCE });
  expect(await listOwnOAuthGrants(f.ctx)).toEqual([]);
  await f.consent(grant.id);
  expect(await listOwnOAuthGrants(f.ctx)).toMatchObject([{ id: grant.id, scopes: ["feedstocks:read"] }]);
  await expect(listAllOAuthGrants(f.ctx)).rejects.toMatchObject({ code: "forbidden" });
  await expect(listAllOAuthGrants({ ...f.ctx, orgRole: "owner" })).rejects.toMatchObject({ code: "forbidden" });
  const owner = { ...f.ctx, userId: f.actorId, orgRole: "owner" as const };
  expect(await listOwnOAuthGrants(owner)).toEqual([]);
  expect(await listAllOAuthGrants(owner)).toMatchObject([{ id: grant.id }]);
  const foreign = { ...f.ctx, organizationId: f.orgIds[1] };
  expect(await listOwnOAuthGrants(foreign)).toEqual([]);
  await expect(listAllOAuthGrants(foreign)).rejects.toMatchObject({ code: "forbidden" });
  await expect(listAllOAuthGrants({ ...owner, organizationId: f.orgIds[1] })).rejects.toMatchObject({ code: "forbidden" });
  await expect(revokeOAuthGrant(foreign, { id: grant.id, expectedVersion: 1 })).rejects.toMatchObject({ code: "not_found" });
  await expect(revokeOAuthGrant(f.ctx, { id: grant.id, expectedVersion: 2 })).rejects.toMatchObject({ code: "stale_version" });
  await revokeOAuthGrant(f.ctx, { id: grant.id, expectedVersion: 1 });
  expect(await listOwnOAuthGrants(f.ctx)).toEqual([]);
  await expect(revokeOAuthGrant(f.ctx, { id: grant.id, expectedVersion: 1 })).rejects.toMatchObject({ code: "stale_version" });
});

it("lets an Owner disconnect another person but refuses a Member", async () => {
  const attempt = f.attempt();
  await selectOAuthOrganization(attempt);
  const grant = await resolveAttemptGrant({ ...attempt, clientId: f.clientId, resource: OAUTH_TEST_RESOURCE });
  await f.consent(grant.id);
  await db.update(members).set({ role: "member" }).where(and(eq(members.userId, f.actorId), eq(members.organizationId, f.ctx.organizationId)));
  const actor = { ...f.ctx, userId: f.actorId };
  await expect(revokeOAuthGrant(actor, { id: grant.id, expectedVersion: 1 })).rejects.toMatchObject({ code: "forbidden" });
  await db.update(members).set({ role: "admin" }).where(and(eq(members.userId, f.actorId), eq(members.organizationId, f.ctx.organizationId)));
  await revokeOAuthGrant(actor, { id: grant.id, expectedVersion: 1 });
  expect(await listAllOAuthGrants(actor)).toEqual([]);
});
