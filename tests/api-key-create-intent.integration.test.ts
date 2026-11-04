import { retainFixtureAdmin } from "./helpers/retained-admin";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { db, withDedicatedLockConnection } from "@/db";
import { apiIdempotencyRecords, apiKeyOwners, apiKeys, members, organizations, users } from "@/db/schema";
import { API_KEY_DEFAULT_EXPIRY_SECONDS } from "@/config/api-keys";
import { APP_FORM_CREDENTIAL_PREFIX } from "@/config/operations";
import { createApiKey } from "@/data-access/api-keys";
import * as credentialAuth from "@/data-access/api-credential-auth";
import * as idempotency from "@/data-access/api-idempotency-records";
import { updateMemberRoleAsPlatformAdmin } from "@/data-access/organizations";
import { auth } from "@/lib/auth/better-auth";
import { resolveApiContext } from "@/lib/auth/api-context";
import { getOAuthConfig } from "@/lib/auth/oauth-config";
import type { OrgContext } from "@/lib/auth/server";
import { makeTestOrgContext } from "./helpers/test-org";

// Override setup.ts's larger test pool before the app's db module is loaded.
const poolEnv = vi.hoisted(() => {
  const original = { max: process.env.DB_POOL_MAX, timeout: process.env.DB_POOL_CONNECTION_TIMEOUT_MS };
  process.env.DB_POOL_MAX = "1";
  process.env.DB_POOL_CONNECTION_TIMEOUT_MS = "2000";
  return original;
});
afterAll(() => {
  if (poolEnv.max === undefined) delete process.env.DB_POOL_MAX;
  else process.env.DB_POOL_MAX = poolEnv.max;
  if (poolEnv.timeout === undefined) delete process.env.DB_POOL_CONNECTION_TIMEOUT_MS;
  else process.env.DB_POOL_CONNECTION_TIMEOUT_MS = poolEnv.timeout;
});
const CONTENDER_TIMEOUT_MS = 2_000;
const DEMOTION_WAIT_MS = 100;

let ctx: OrgContext;
let other: OrgContext;
const input = { name: "Intent integration", scopes: ["feedstocks:read"], expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS };

// Same verified Admin/member setup as api-credentials.test.ts, with one user in two orgs.
beforeEach(async () => {
  ctx = { ...makeTestOrgContext(`api-intent-user-${randomUUID()}`), organizationId: `api-intent-${randomUUID()}` };
  other = { ...ctx, organizationId: `api-intent-other-${randomUUID()}` };
  await db.insert(organizations).values([ctx, other].map(({ organizationId }) => ({
    id: organizationId, name: "API intent fixture", slug: organizationId,
  })));
  await db.insert(users).values({ id: ctx.userId, name: "API intent owner", email: `${ctx.userId}@example.test`, emailVerified: true });
  await retainFixtureAdmin(ctx.organizationId);
  await retainFixtureAdmin(other.organizationId);
  await db.insert(members).values([ctx, other].map(({ organizationId }) => ({
    id: randomUUID(), organizationId, userId: ctx.userId, role: "admin",
  })));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await db.delete(organizations).where(inArray(organizations.id, [ctx.organizationId, other.organizationId]));
  await db.delete(users).where(eq(users.id, ctx.userId));
});

async function keyIds(context = ctx) {
  return db.select({ id: apiKeys.id }).from(apiKeys).where(eq(apiKeys.referenceId, context.organizationId));
}
async function outcome(intentKey: string, context = ctx) {
  return db.select({ id: apiIdempotencyRecords.id, outcome: apiIdempotencyRecords.outcome }).from(apiIdempotencyRecords).where(and(
    eq(apiIdempotencyRecords.organizationId, context.organizationId),
    eq(apiIdempotencyRecords.credentialId, `${APP_FORM_CREDENTIAL_PREFIX}${context.userId}`),
    eq(apiIdempotencyRecords.idempotencyKey, intentKey),
  ));
}

it.each([false, true])("replaces the unseen key and stores only its new id (edited name: %s)", async (edited) => {
  expect((db.$client as Pool).options.max).toBe(1);
  const intentKey = randomUUID();
  const first = await createApiKey(ctx, input, intentKey);
  const [originalRecord] = await outcome(intentKey);
  const second = await createApiKey(ctx, { ...input, name: edited ? "Edited integration" : input.name }, intentKey);
  expect(await keyIds()).toEqual([{ id: second.id }]);
  expect(second.id).not.toBe(first.id);
  expect(second.key === first.key).toBe(false);
  expect(second.name).toBe(edited ? "Edited integration" : input.name);
  expect(await db.select({ id: apiKeyOwners.credentialId }).from(apiKeyOwners)
    .where(eq(apiKeyOwners.organizationId, ctx.organizationId))).toEqual([{ id: second.id }]);
  const records = await outcome(intentKey);
  expect(records).toEqual([{ id: originalRecord.id, outcome: { kind: "success", data: { id: second.id } } }]);
  const stored = JSON.stringify(records);
  expect(stored.includes(first.key) || stored.includes(second.key)).toBe(false);
});

it("scopes the same user's same intent independently to each organization", async () => {
  const intentKey = randomUUID();
  const first = await createApiKey(ctx, input, intentKey);
  await createApiKey(other, input, intentKey);
  const second = await createApiKey(other, input, intentKey);
  expect(await keyIds()).toEqual([{ id: first.id }]);
  expect(await keyIds(other)).toEqual([{ id: second.id }]);
  expect(await outcome(intentKey)).toHaveLength(1);
  expect(await outcome(intentKey, other)).toHaveLength(1);
});

it("holds neither expired previous-key nor member row locks during pooled issuance", async () => {
  expect((db.$client as Pool).options.max).toBe(1);
  const intentKey = randomUUID();
  const first = await createApiKey(ctx, input, intentKey);
  await db.update(apiKeys).set({ expiresAt: new Date(0) }).where(and(
    eq(apiKeys.id, first.id), eq(apiKeys.referenceId, ctx.organizationId),
  ));
  const original = auth.api.createApiKey;
  vi.spyOn(auth.api, "createApiKey").mockImplementationOnce(async (...args) => {
    // Model cleanup and a membership writer on the sole pooled connection.
    // NOWAIT fails deterministically if the dedicated transaction locked either row.
    await db.transaction(async (tx) => {
      expect(await tx.select({ id: apiKeys.id }).from(apiKeys).where(and(
        eq(apiKeys.id, first.id), eq(apiKeys.referenceId, ctx.organizationId),
      )).for("update", { noWait: true })).toEqual([{ id: first.id }]);
      expect(await tx.select({ id: members.id }).from(members).where(and(
        eq(members.organizationId, ctx.organizationId), eq(members.userId, ctx.userId),
      )).for("no key update", { noWait: true })).toHaveLength(1);
    });
    return original(...args);
  });
  const second = await createApiKey(ctx, input, intentKey);
  expect(await keyIds()).toEqual([{ id: second.id }]);
  expect((await outcome(intentKey))[0].outcome).toEqual({ kind: "success", data: { id: second.id } });
});

it("rolls back replacement and disables the new key when the membership re-check fails", async () => {
  const intentKey = randomUUID();
  const first = await createApiKey(ctx, input, intentKey);
  const originalRecord = await outcome(intentKey);
  const original = auth.api.createApiKey;
  const guard = vi.spyOn(auth.api, "createApiKey").mockImplementationOnce(async (...args) => {
    const result = await original(...args);
    await db.update(users).set({ emailVerified: false }).where(eq(users.id, ctx.userId));
    return result;
  });
  await expect(createApiKey(ctx, input, intentKey)).rejects.toMatchObject({
    code: "forbidden", message: "Credential owner membership changed during issuance.",
  });
  guard.mockRestore();
  await db.update(users).set({ emailVerified: true }).where(eq(users.id, ctx.userId));
  expect(await outcome(intentKey)).toEqual(originalRecord);
  const rows = await db.select({ id: apiKeys.id, enabled: apiKeys.enabled }).from(apiKeys)
    .where(eq(apiKeys.referenceId, ctx.organizationId));
  expect(rows.find(row => row.id === first.id)?.enabled).toBe(true);
  expect(rows.filter(row => row.id !== first.id)).toEqual([{ id: expect.any(String), enabled: false }]);
  expect(await db.select({ id: apiKeyOwners.credentialId }).from(apiKeyOwners)
    .where(eq(apiKeyOwners.organizationId, ctx.organizationId))).toEqual([{ id: first.id }]);
  const retry = await createApiKey(ctx, input, intentKey);
  expect(await outcome(intentKey)).toEqual([{ id: originalRecord[0].id, outcome: { kind: "success", data: { id: retry.id } } }]);
});

it("waits for keyed issuance before demotion revokes the key permanently", async () => {
  const member = await credentialAuth.findApiCredentialMember(ctx.organizationId, ctx.userId);
  await db.update(members).set({ role: "admin" }).where(and(
    eq(members.id, member.id), eq(members.organizationId, ctx.organizationId), eq(members.userId, ctx.userId),
  ));
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const updating = Promise.withResolvers<void>();
  const original = idempotency.recordIdempotencyOutcome;
  vi.spyOn(idempotency, "recordIdempotencyOutcome").mockImplementationOnce(async (...args) => {
    // Owner is bound and membership locked, but neither is committed yet.
    entered.resolve();
    await release.promise;
    return original(...args);
  });
  const creating = createApiKey(ctx, input, randomUUID());
  let demotion: Promise<unknown> | undefined;
  let created: Awaited<typeof creating>;
  try {
    await Promise.race([entered.promise, creating]);
    // A dedicated writer avoids pool starvation while issuance holds the member.
    demotion = withDedicatedLockConnection(async (tx) => {
      updating.resolve();
      await tx.update(members).set({ role: "member" }).where(and(
        eq(members.id, member.id), eq(members.organizationId, ctx.organizationId), eq(members.userId, ctx.userId),
      ));
      await credentialAuth.disableOwnerApiKeys(ctx.organizationId, ctx.userId, tx);
    });
    await updating.promise;
    expect(await Promise.race([
      demotion.then(() => "completed"),
      new Promise<string>(resolve => setTimeout(() => resolve("waiting"), DEMOTION_WAIT_MS)),
    ])).toBe("waiting");
  } finally {
    release.resolve();
    created = await creating;
    await demotion;
  }
  const state = () => db.select({ enabled: apiKeys.enabled, revokedAt: apiKeyOwners.revokedAt })
    .from(apiKeys).innerJoin(apiKeyOwners, eq(apiKeyOwners.credentialId, apiKeys.id))
    .where(and(eq(apiKeys.id, created.id), eq(apiKeys.referenceId, ctx.organizationId),
      eq(apiKeyOwners.organizationId, ctx.organizationId)));
  const revoked = await state();
  expect(revoked).toEqual([{ enabled: false, revokedAt: expect.any(Date) }]);
  await db.update(members).set({ role: "admin" }).where(and(
    eq(members.id, member.id), eq(members.organizationId, ctx.organizationId), eq(members.userId, ctx.userId),
  ));
  expect(await state()).toEqual(revoked);
  expect(await resolveApiContext(new Request("http://localhost:3100/api/v1/me", {
    headers: { authorization: `Bearer ${created.key}` },
  }), getOAuthConfig().rest)).toEqual({ ok: false, denial: "credential_owner_removed" });
});

it.each([false, true])("refuses a concurrent claim before issuing another key (replay: %s)", async (replay) => {
  const intentKey = randomUUID();
  if (replay) await createApiKey(ctx, input, intentKey);
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const original = auth.api.createApiKey;
  const issuance = vi.spyOn(auth.api, "createApiKey")
    .mockImplementationOnce(async (...args) => {
      entered.resolve();
      await release.promise;
      return original(...args);
    });
  const claims = vi.spyOn(idempotency, "claimIdempotencyKey");
  const first = createApiKey(ctx, input, intentKey);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let winner: Awaited<typeof first>;
  try {
    await Promise.race([entered.promise, first]);
    await Promise.race([
      expect(createApiKey(ctx, input, intentKey)).rejects.toMatchObject({ code: "idempotency_in_progress" }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Contender waited for the held transaction")), CONTENDER_TIMEOUT_MS);
      }),
    ]);
    // A row-lock timeout is not enough: the contender must fail before claiming.
    expect(claims).toHaveBeenCalledTimes(1);
    expect(issuance).toHaveBeenCalledTimes(1);
  } finally {
    clearTimeout(timer);
    release.resolve();
    winner = await first;
  }
  expect(await db.select({ id: apiKeys.id, enabled: apiKeys.enabled }).from(apiKeys)
    .where(eq(apiKeys.referenceId, ctx.organizationId))).toEqual([{ id: winner.id, enabled: true }]);
});

// A replay overlapping a membership writer: both must finish, never 40P01.
async function setRole(memberId: string, role: "admin" | "member") {
  await db.update(members).set({ role }).where(and(
    eq(members.id, memberId), eq(members.organizationId, ctx.organizationId), eq(members.userId, ctx.userId),
  ));
}
async function expectUnusable(key: string) {
  expect(await resolveApiContext(new Request("http://localhost:3100/api/v1/me", {
    headers: { authorization: `Bearer ${key}` },
  }), getOAuthConfig().rest)).toMatchObject({ ok: false });
}

it("finishes a replay overlapping a platform-admin demotion, leaving the new key revoked", async () => {
  const member = await credentialAuth.findApiCredentialMember(ctx.organizationId, ctx.userId);
  await setRole(member.id, "admin");
  const intentKey = randomUUID();
  const first = await createApiKey(ctx, input, intentKey);
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const original = idempotency.recordIdempotencyOutcome;
  vi.spyOn(idempotency, "recordIdempotencyOutcome").mockImplementationOnce(async (...args) => {
    // Issued, member locked, previous key deleted, owner bound; nothing committed.
    entered.resolve();
    await release.promise;
    return original(...args);
  });
  const replaying = createApiKey(ctx, input, intentKey);
  let demotion: Promise<unknown> | undefined;
  let created: Awaited<typeof replaying>;
  try {
    await Promise.race([entered.promise, replaying]);
    demotion = updateMemberRoleAsPlatformAdmin({ ...ctx, isPlatformAdmin: true }, member.id, "member");
    expect(await Promise.race([
      demotion.then(() => "completed"),
      new Promise<string>(resolve => setTimeout(() => resolve("waiting"), DEMOTION_WAIT_MS)),
    ])).toBe("waiting");
  } finally {
    release.resolve();
    created = await replaying;
    await demotion;
  }
  expect(await keyIds()).toEqual([{ id: created.id }]);
  expect(first.id).not.toBe(created.id);
  await setRole(member.id, "admin");
  expect(await db.select({ enabled: apiKeys.enabled, revokedAt: apiKeyOwners.revokedAt })
    .from(apiKeys).innerJoin(apiKeyOwners, eq(apiKeyOwners.credentialId, apiKeys.id))
    .where(and(eq(apiKeys.id, created.id), eq(apiKeys.referenceId, ctx.organizationId))))
    .toEqual([{ enabled: false, revokedAt: expect.any(Date) }]);
  await expectUnusable(created.key);
});

it("locks the member before the previous key, so a member-first demotion cannot deadlock a replay", async () => {
  const member = await credentialAuth.findApiCredentialMember(ctx.organizationId, ctx.userId);
  await setRole(member.id, "admin");
  const intentKey = randomUUID();
  const first = await createApiKey(ctx, input, intentKey);
  const memberLocked = Promise.withResolvers<void>();
  let demotion: Promise<unknown> | undefined;
  const original = auth.api.createApiKey;
  vi.spyOn(auth.api, "createApiKey").mockImplementationOnce(async (...args) => {
    const issued = await original(...args);
    // Better Auth's role update order: member row first, then the owner and key rows.
    demotion = withDedicatedLockConnection(async (tx) => {
      await tx.update(members).set({ role: "member" }).where(and(
        eq(members.id, member.id), eq(members.organizationId, ctx.organizationId), eq(members.userId, ctx.userId),
      ));
      memberLocked.resolve();
      await new Promise(resolve => setTimeout(resolve, DEMOTION_WAIT_MS));
      await credentialAuth.disableOwnerApiKeys(ctx.organizationId, ctx.userId, tx);
    });
    await memberLocked.promise;
    return issued;
  });
  // The demotion commits first; the re-check then refuses and the new key is disabled.
  await expect(createApiKey(ctx, input, intentKey)).rejects.toMatchObject({ code: "forbidden" });
  await demotion;
  await setRole(member.id, "admin");
  const rows = await db.select({ id: apiKeys.id, enabled: apiKeys.enabled }).from(apiKeys)
    .where(eq(apiKeys.referenceId, ctx.organizationId));
  expect(rows).toHaveLength(2);
  expect(rows.every(row => !row.enabled)).toBe(true);
  await expectUnusable(first.key);
});

it("finishes keyed issuance holding its FK claim while a plugin role UPDATE completes", async () => {
  const member = await credentialAuth.findApiCredentialMember(ctx.organizationId, ctx.userId);
  const original = auth.api.createApiKey;
  let demotion: Promise<unknown> | undefined;
  vi.spyOn(auth.api, "createApiKey").mockImplementationOnce(async (...args) => {
    const issued = await original(...args);
    // The claim is inserted and its organization FK KEY SHARE is still held.
    // The trigger must complete without waiting for that transaction to finish.
    demotion = withDedicatedLockConnection(async tx => {
      await tx.execute(sql`select set_config('lock_timeout', ${String(CONTENDER_TIMEOUT_MS)}, true)`);
      await tx.update(members).set({ role: "member" }).where(and(
        eq(members.id, member.id), eq(members.organizationId, ctx.organizationId),
      ));
    });
    await demotion;
    return issued;
  });
  const creating = createApiKey(ctx, input, randomUUID());
  // The role update wins; issuance finishes with the expected membership refusal.
  await expect(creating).rejects.toMatchObject({ code: "forbidden" });
  await expect(demotion).resolves.toBeUndefined();
  expect(await db.select({ role: members.role }).from(members).where(eq(members.id, member.id)))
    .toEqual([{ role: "member" }]);
  expect(await db.select().from(members).where(and(
    eq(members.organizationId, ctx.organizationId), eq(members.role, "admin"),
  ))).toHaveLength(1);
});
