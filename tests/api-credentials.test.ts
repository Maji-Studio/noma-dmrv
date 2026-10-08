/** DB-backed contract suite. Run only after generating/applying the API-key migration. */
import { createHmac, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { apiKeyOwners, apiKeys, facilities, members, organizations, sessions, users } from "@/db/schema";
import { env } from "@/config/env";
import { API_KEY_DEFAULT_EXPIRY_SECONDS, API_KEY_MAX_EXPIRY_SECONDS, MILLISECONDS_PER_SECOND } from "@/config/api-keys";
import { auth } from "@/lib/auth/better-auth";
import { resolveApiContext } from "@/lib/auth/api-context";
import { createApiKey, listApiKeys, revokeApiKey, updateApiKey } from "@/data-access/api-keys";
import { disableOwnerApiKeys } from "@/data-access/api-credential-auth";
import { removeMemberAsPlatformAdmin, updateMemberRoleAsPlatformAdmin } from "@/data-access/organizations";
import { GET } from "@/app/api/v1/me/route";
import { makeTestOrgContext } from "./helpers/test-org";
import type { OrgContext } from "@/lib/auth/server";

let ctx: OrgContext;

let otherOrg: string;

let actorId: string;

let membershipId: string;

let adminHeaders: Headers;

const input = () => ({
  name: "Intake integration",
  scopes: ["feedstocks:read"],
  expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS,
});

const request = (key?: string, extras: Record<string, string> = {}) => new Request("http://localhost:3100/api/v1/me", {
  headers: {
    ...(key ? { authorization: `Bearer ${key}` } : {}),
    ...extras,
  },
});

beforeEach(async () => {
  const suffix = randomUUID();
  ctx = {
    ...makeTestOrgContext(`api-owner-${suffix}`),
    organizationId: `api-org-${suffix}`,
  };
  otherOrg = `api-other-${suffix}`;
  actorId = `api-actor-${suffix}`;
  membershipId = randomUUID();
  await db.insert(organizations)
    .values([
      {
        id: ctx.organizationId,
        name: "API Organization A",
        slug: ctx.organizationId,
      },
      {
        id: otherOrg,
        name: "API Organization B",
        slug: otherOrg,
      },
    ]);
  await db.insert(users)
    .values([ctx.userId, actorId].map((id) => ({
      id,
      email: `${id}@example.test`,
      name: "API test user",
      emailVerified: true,
    })));
  await db.insert(members)
    .values([
      {
        id: membershipId,
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        role: "admin",
      },
      {
        id: randomUUID(),
        organizationId: ctx.organizationId,
        userId: actorId,
        role: "owner",
      },
    ]);
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + API_KEY_DEFAULT_EXPIRY_SECONDS * MILLISECONDS_PER_SECOND);
  await db.insert(sessions)
    .values({
      id: randomUUID(),
      userId: actorId,
      token,
      expiresAt,
      activeOrganizationId: ctx.organizationId,
    });
  const signature = createHmac("sha256", env.BETTER_AUTH_SECRET).update(token).digest("base64");
  const context = await auth.$context;
  adminHeaders = new Headers({ cookie: `${context.authCookies.sessionToken.name}=${encodeURIComponent(`${token}.${signature}`)}` });
});

afterEach(async () => {
  await db.delete(facilities)
    .where(inArray(facilities.organizationId, [ctx.organizationId, otherOrg]));
  await db.delete(organizations)
    .where(inArray(organizations.id, [ctx.organizationId, otherOrg]));
  await db.delete(users)
    .where(inArray(users.id, [ctx.userId, actorId]));
});

async function storedManagementState(id: string) {
  return db.select({
    name: apiKeys.name, permissions: apiKeys.permissions, enabled: apiKeys.enabled,
    updatedAt: apiKeys.updatedAt, version: apiKeyOwners.version,
    revokedAt: apiKeyOwners.revokedAt, revocationReason: apiKeyOwners.revocationReason,
  }).from(apiKeys)
    .innerJoin(apiKeyOwners, eq(apiKeyOwners.credentialId, apiKeys.id))
    .where(and(eq(apiKeys.id, id), eq(apiKeys.referenceId, ctx.organizationId),
      eq(apiKeyOwners.organizationId, ctx.organizationId)));
}

describe("credential issuance and management", () => {
  it("refuses a non-member Platform Admin despite a forged context role", async () => {
    await db.delete(members)
      .where(eq(members.id, membershipId));
    await db.update(users)
      .set({ role: "admin" })
      .where(eq(users.id, ctx.userId));
    await expect(createApiKey({
      ...ctx,
      isPlatformAdmin: true,
    }, input())).rejects.toMatchObject({ code: "forbidden" });
  });
  it("refuses a Member", async () => {
    await db.update(members)
      .set({ role: "member" })
      .where(eq(members.id, membershipId));
    await expect(createApiKey(ctx, input())).rejects.toMatchObject({ code: "forbidden" });
  });
  it("refuses an unverified admin", async () => {
    await db.update(users)
      .set({ emailVerified: false })
      .where(eq(users.id, ctx.userId));
    await expect(createApiKey(ctx, input())).rejects.toMatchObject({ code: "forbidden" });
  });
  it.each([
    { scopes: ["facilities:write"] }, { scopes: ["feedstocks:*"] },
    { expiresIn: undefined }, { expiresIn: null }, { expiresIn: API_KEY_MAX_EXPIRY_SECONDS + 1 },
    { organizationId: "other" },
  ])("rejects unsafe issuance input %j", async (override) => {
    await expect(createApiKey(ctx, {
      ...input(),
      ...override,
    })).rejects.toThrow();
  });
  it("returns plaintext only from create, stores a hash and retains revoked records", async () => {
    const created = await createApiKey(ctx, input());
    expect(created.key.startsWith("noma_test_")).toBe(true);
    const [stored] = await db.select()
      .from(apiKeys)
      .where(eq(apiKeys.id, created.id));
    expect(stored.key).not.toBe(created.key);
    expect(stored.rateLimitEnabled).toBe(false);
    expect(stored.referenceId).toBe(ctx.organizationId);
    const listed = await listApiKeys(ctx);
    expect(listed[0]).toMatchObject({
      id: created.id,
      ownerId: ctx.userId,
      permissions: { feedstocks: ["read"] },
      enabled: true,
    });
    expect(listed[0]).not.toHaveProperty("key");
    expect(JSON.stringify(listed)).not.toContain(stored.key);
    expect(await updateApiKey(ctx, {
      id: created.id,
      expectedVersion: 1,
      name: "Renamed",
      scopes: [],
    })).toEqual({ id: created.id });
    await expect(updateApiKey(ctx, {
      id: created.id,
      expectedVersion: 1,
      name: "Renamed",
      scopes: [],
      expiresIn: null,
    })).rejects.toThrow();
    await revokeApiKey(ctx, { id: created.id, expectedVersion: 2 });
    expect((await listApiKeys(ctx))[0]).toMatchObject({
      enabled: false,
      expiresAt: stored.expiresAt,
    });
    expect(await resolveApiContext(request(created.key))).toEqual({
      ok: false,
      denial: "credential_revoked",
    });
  });
  it("refuses a stale permission edit without restoring removed Delete permission", async () => {
    const created = await createApiKey(ctx, { ...input(), scopes: ["feedstocks:read", "feedstocks:delete"] });
    const [loaded] = await listApiKeys(ctx);
    await updateApiKey(ctx, { id: created.id, expectedVersion: loaded.version, name: "Restricted", scopes: ["feedstocks:read"] });
    const beforeStaleEdit = await storedManagementState(created.id);
    await expect(updateApiKey(ctx, {
      id: created.id, expectedVersion: loaded.version, name: "Stale rename",
      scopes: ["feedstocks:read", "feedstocks:delete"],
    })).rejects.toMatchObject({ code: "stale_version" });
    expect(await storedManagementState(created.id)).toEqual(beforeStaleEdit);
    expect((await listApiKeys(ctx))[0]).toMatchObject({
      name: "Restricted", version: loaded.version + 1, permissions: { feedstocks: ["read"] },
    });
  });
  it.each(["edit", "revoke"])("rolls back the credential and version together when %s fails before commit", async (action) => {
    const created = await createApiKey(ctx, input());
    const before = await storedManagementState(created.id);
    const transaction = db.transaction.bind(db);
    const failure = new Error("Injected pre-commit failure");
    const spy = vi.spyOn(db, "transaction").mockImplementationOnce((work, config) =>
      transaction(async (tx) => {
        await work(tx);
        throw failure;
      }, config));
    try {
      const mutation = action === "edit"
        ? updateApiKey(ctx, { id: created.id, expectedVersion: 1, name: "Changed", scopes: [] })
        : revokeApiKey(ctx, { id: created.id, expectedVersion: 1 });
      await expect(mutation).rejects.toBe(failure);
    } finally {
      spy.mockRestore();
    }
    expect(await storedManagementState(created.id)).toEqual(before);
    if (action === "edit") {
      await updateApiKey(ctx, { id: created.id, expectedVersion: 1, name: "Changed", scopes: [] });
      expect(await storedManagementState(created.id)).toMatchObject([{ name: "Changed", permissions: "{}", version: 2 }]);
    } else {
      await revokeApiKey(ctx, { id: created.id, expectedVersion: 1 });
      expect(await storedManagementState(created.id)).toMatchObject([{
        enabled: false, version: 2, revokedAt: expect.any(Date), revocationReason: "credential_revoked",
      }]);
    }
  });
  it("refuses a stale revoke and leaves the edited key enabled", async () => {
    const created = await createApiKey(ctx, input());
    const [loaded] = await listApiKeys(ctx);
    await updateApiKey(ctx, { id: created.id, expectedVersion: loaded.version, name: "Current", scopes: [] });
    await expect(revokeApiKey(ctx, { id: created.id, expectedVersion: loaded.version }))
      .rejects.toMatchObject({ code: "stale_version" });
    expect((await listApiKeys(ctx))[0]).toMatchObject({ name: "Current", enabled: true, version: loaded.version + 1 });
  });
  it("preserves manual revocation history when the owner is disabled again", async () => {
    const created = await createApiKey(ctx, input());
    await revokeApiKey(ctx, { id: created.id, expectedVersion: 1 });
    const [before] = await db.select().from(apiKeyOwners).where(eq(apiKeyOwners.credentialId, created.id));
    await disableOwnerApiKeys(ctx.organizationId, ctx.userId);
    const [after] = await db.select().from(apiKeyOwners).where(eq(apiKeyOwners.credentialId, created.id));
    expect(after).toEqual(before);
    expect(after.revocationReason).toBe("credential_revoked");
    expect((await listApiKeys(ctx))[0].enabled).toBe(false);
  });
  it("does not allow mutations or listing by another organization", async () => {
    const created = await createApiKey(ctx, input());
    const foreign = {
      ...ctx,
      organizationId: otherOrg,
    };
    await db.insert(members)
      .values({
        id: randomUUID(),
        organizationId: otherOrg,
        userId: ctx.userId,
        role: "admin",
      });
    expect(await listApiKeys(foreign)).toEqual([]);
    await expect(updateApiKey(foreign, {
      id: created.id,
      expectedVersion: 1,
      name: "Hijack",
      scopes: [],
    })).rejects.toMatchObject({ code: "not_found" });
    await expect(revokeApiKey(foreign, { id: created.id, expectedVersion: 1 })).rejects.toMatchObject({ code: "not_found" });
  });
  it.each(["create", "update", "delete"])("refuses the client plugin %s endpoint even with an Owner cookie", async (action) => {
    const created = await createApiKey(ctx, input());
    const response = await auth.handler(new Request(`http://localhost:3100/api/auth/api-key/${action}`, {
      method: "POST",
      headers: {
        cookie: adminHeaders.get("cookie")!,
        "content-type": "application/json",
        origin: "http://localhost:3100",
      },
      body: JSON.stringify({
        name: "Bypass",
        organizationId: ctx.organizationId,
        keyId: created.id,
        expiresIn: null,
      }),
    }));
    expect(response.status).toBe(403);
    expect((await listApiKeys(ctx))[0]).toMatchObject({
      id: created.id,
      enabled: true,
    });
  });
});

describe("credential resolution", () => {
  it.each(["leave", "direct delete"])("permanently refuses keys after %s and Admin re-admission", async (action) => {
    const created = await createApiKey(ctx, input());
    const [issuedOwner] = await db.select()
      .from(apiKeyOwners)
      .where(eq(apiKeyOwners.credentialId, created.id));
    expect(issuedOwner.memberId).toBe(membershipId);
    if (action === "leave") {
      const token = randomUUID();
      await db.insert(sessions)
        .values({
          id: randomUUID(),
          userId: ctx.userId,
          token,
          expiresAt: new Date(Date.now() + API_KEY_DEFAULT_EXPIRY_SECONDS * MILLISECONDS_PER_SECOND),
          activeOrganizationId: ctx.organizationId,
        });
      const signature = createHmac("sha256", env.BETTER_AUTH_SECRET).update(token).digest("base64");
      const context = await auth.$context;
      const headers = new Headers({
        cookie: `${context.authCookies.sessionToken.name}=${encodeURIComponent(`${token}.${signature}`)}`,
      });
      await auth.api.leaveOrganization({
        headers,
        body: { organizationId: ctx.organizationId },
      });
    } else {
      await db.delete(members)
        .where(eq(members.id, membershipId));
    }
    const [removedMember] = await db.select()
      .from(members)
      .where(eq(members.id, membershipId));
    expect(removedMember).toBeUndefined();
    const [owner] = await db.select()
      .from(apiKeyOwners)
      .where(eq(apiKeyOwners.credentialId, created.id));
    expect(owner.memberId).toBeNull();
    expect(owner.revokedAt).toBeNull();
    expect(await resolveApiContext(request(created.key))).toEqual({
      ok: false,
      denial: "credential_owner_removed",
    });
    const managerCtx = {
      ...ctx,
      userId: actorId,
      orgRole: "owner" as const,
    };
    expect((await listApiKeys(managerCtx)).find((key) => key.id === created.id)?.enabled).toBe(false);
    await auth.api.addMember({
      body: {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        role: "admin",
      },
    });
    expect(await resolveApiContext(request(created.key))).toEqual({
      ok: false,
      denial: "credential_owner_removed",
    });
    expect((await GET(request(created.key))).status).toBe(401);
    expect((await listApiKeys(ctx)).find((key) => key.id === created.id)?.enabled).toBe(false);
    const replacement = await createApiKey(ctx, input());
    expect(await resolveApiContext(request(replacement.key))).toMatchObject({ ok: true });
  });
  it("resolves a verified live Admin with no platform override and updates last-used", async () => {
    const created = await createApiKey(ctx, input());
    expect(await resolveApiContext(request(created.key))).toMatchObject({
      ok: true,
      ctx: {
        userId: ctx.userId,
        organizationId: ctx.organizationId,
        orgRole: "admin",
        isPlatformAdmin: false,
        credentialId: created.id,
        scopes: ["feedstocks:read"],
      },
    });
    expect((await listApiKeys(ctx))[0].lastUsedAt).toBeInstanceOf(Date);
    expect((await listApiKeys(ctx))[0].version).toBe(1);
  });
  it.each(["expired", "disabled", "removed", "demoted", "unverified"])("denies %s credentials", async (state) => {
    const created = await createApiKey(ctx, input());
    if (state === "expired") await db.update(apiKeys)
      .set({ expiresAt: new Date(0) })
      .where(eq(apiKeys.id, created.id));
    if (state === "disabled") await db.update(apiKeys)
      .set({ enabled: false })
      .where(eq(apiKeys.id, created.id));
    if (state === "removed") await db.delete(members)
      .where(eq(members.id, membershipId));
    if (state === "demoted") await db.update(members)
      .set({ role: "member" })
      .where(eq(members.id, membershipId));
    if (state === "unverified") await db.update(users)
      .set({ emailVerified: false })
      .where(eq(users.id, ctx.userId));
    const denial = state === "removed" || state === "demoted" ? "credential_owner_removed" : state === "unverified" ? "credential_owner_unverified" : `credential_${state}`;
    expect(await resolveApiContext(request(created.key))).toEqual({
      ok: false,
      denial,
    });
    expect((await GET(request(created.key))).status).toBe(401);
  });
  it("rejects two credentials, ignores cookies with a bearer, refuses cookie-only and bad bearer fallback", async () => {
    const created = await createApiKey(ctx, input());
    expect(await resolveApiContext(request(created.key, { "x-api-key": created.key }))).toEqual({
      ok: false,
      denial: "credential_ambiguous",
    });
    expect(await resolveApiContext(request(created.key, { cookie: adminHeaders.get("cookie")! }))).toMatchObject({
      ok: true,
      ctx: { userId: ctx.userId },
    });
    expect(await resolveApiContext(request(undefined, { cookie: adminHeaders.get("cookie")! }))).toEqual({
      ok: false,
      denial: "cookie_session_unsupported",
    });
    expect(await resolveApiContext(request("unknown", { cookie: adminHeaders.get("cookie")! }))).toEqual({
      ok: false,
      denial: "credential_invalid",
    });
  });
  it.each(["remove", "demote"])("organization %s hook disables and retains keys", async (action) => {
    const created = await createApiKey(ctx, input());
    await db.insert(members)
      .values({
        id: randomUUID(),
        organizationId: otherOrg,
        userId: ctx.userId,
        role: "admin",
      });
    const otherKey = await createApiKey({
      ...ctx,
      organizationId: otherOrg,
    }, input());
    if (action === "remove") await auth.api.removeMember({
      headers: adminHeaders,
      body: {
        organizationId: ctx.organizationId,
        memberIdOrEmail: membershipId,
      },
    });
    else await auth.api.updateMemberRole({
      headers: adminHeaders,
      body: {
        organizationId: ctx.organizationId,
        memberId: membershipId,
        role: "member",
      },
    });
    const [stored] = await db.select()
      .from(apiKeys)
      .where(eq(apiKeys.id, created.id));
    expect(stored.enabled).toBe(false);
    const [owner] = await db.select().from(apiKeyOwners).where(eq(apiKeyOwners.credentialId, created.id));
    expect(owner).toMatchObject({ version: 2, revocationReason: "credential_owner_removed" });
    expect(await resolveApiContext(request(created.key))).toEqual({
      ok: false,
      denial: "credential_owner_removed",
    });
    expect(await resolveApiContext(request(otherKey.key))).toMatchObject({
      ok: true,
      ctx: { organizationId: otherOrg },
    });
  });
});

it("/me permits an empty scope set and returns only the key organization's facilities", async () => {
  const created = await createApiKey(ctx, {
    ...input(),
    scopes: [],
  });
  await db.insert(facilities)
    .values([
      {
        organizationId: ctx.organizationId,
        code: "A",
        name: "Facility A",
        timezone: "Pacific/Kiritimati",
      },
      {
        organizationId: otherOrg,
        code: "B",
        name: "Facility B",
        timezone: "America/Los_Angeles",
      },
    ]);
  const response = await GET(request(created.key));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("x-request-id")).toBeTruthy();
  const { data } = await response.json();
  expect(Object.keys(data).sort()).toEqual(["credential", "facilities", "organization", "role", "scopes"]);
  expect(data.organization).toEqual({
    id: ctx.organizationId,
    name: "API Organization A",
  });
  expect(data.scopes).toEqual([]);
  expect(data.role).toBe("admin");
  expect(data.facilities).toHaveLength(1);
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Kiritimati",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  expect(data.facilities[0]).toMatchObject({
    code: "A",
    name: "Facility A",
    timeZone: "Pacific/Kiritimati",
    today: date,
  });
  expect(data.credential).toEqual({
    id: created.id,
    name: created.name,
    expiresAt: created.expiresAt?.toISOString(),
  });
  expect(JSON.stringify(data)).not.toContain(created.key);
});

it.each(["remove", "demote"])("Platform Admin %s override disables credentials in the same transaction", async (action) => {
  const created = await createApiKey(ctx, input());
  const platformCtx = {
    ...ctx,
    userId: actorId,
    orgRole: null,
    isPlatformAdmin: true,
  };
  if (action === "remove") await removeMemberAsPlatformAdmin(platformCtx, membershipId);
  else await updateMemberRoleAsPlatformAdmin(platformCtx, membershipId, "member");
  const [stored] = await db.select()
    .from(apiKeys)
    .where(eq(apiKeys.id, created.id));
  expect(stored.enabled).toBe(false);
  const [owner] = await db.select().from(apiKeyOwners).where(eq(apiKeyOwners.credentialId, created.id));
  expect(owner).toMatchObject({ version: 2, revocationReason: "credential_owner_removed" });
  expect(await resolveApiContext(request(created.key))).toEqual({
    ok: false,
    denial: "credential_owner_removed",
  });
});
