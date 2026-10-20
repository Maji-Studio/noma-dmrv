import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { db } from "@/db";
import { apiIdempotencyRecords, apiKeyOwners, apiKeys, members, organizations, users } from "@/db/schema";
import { API_KEY_DEFAULT_EXPIRY_SECONDS } from "@/config/api-keys";
import { APP_FORM_CREDENTIAL_PREFIX } from "@/config/operations";
import { createApiKey } from "@/data-access/api-keys";
import * as credentialAuth from "@/data-access/api-credential-auth";
import * as idempotency from "@/data-access/api-idempotency-records";
import { auth } from "@/lib/auth/better-auth";
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

let ctx: OrgContext;
let other: OrgContext;
const input = { name: "Intent integration", scopes: ["feedstocks:read"], expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS };

// Same verified Owner/member setup as api-credentials.test.ts, with one user in two orgs.
beforeEach(async () => {
  ctx = { ...makeTestOrgContext(`api-intent-user-${randomUUID()}`), organizationId: `api-intent-${randomUUID()}` };
  other = { ...ctx, organizationId: `api-intent-other-${randomUUID()}` };
  await db.insert(organizations).values([ctx, other].map(({ organizationId }) => ({
    id: organizationId, name: "API intent fixture", slug: organizationId,
  })));
  await db.insert(users).values({ id: ctx.userId, name: "API intent owner", email: `${ctx.userId}@example.test`, emailVerified: true });
  await db.insert(members).values([ctx, other].map(({ organizationId }) => ({
    id: randomUUID(), organizationId, userId: ctx.userId, role: "owner",
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

it("rolls back replacement and disables the new key when the membership re-check fails", async () => {
  const intentKey = randomUUID();
  const first = await createApiKey(ctx, input, intentKey);
  const originalRecord = await outcome(intentKey);
  const member = await credentialAuth.findApiCredentialMember(ctx.organizationId, ctx.userId);
  const guard = vi.spyOn(credentialAuth, "findApiCredentialMember")
    .mockResolvedValueOnce(member).mockResolvedValueOnce({ ...member, id: randomUUID() });
  await expect(createApiKey(ctx, input, intentKey)).rejects.toMatchObject({ code: "forbidden" });
  guard.mockRestore();
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
