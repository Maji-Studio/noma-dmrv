import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { APP_FORM_CREDENTIAL_PREFIX } from "@/config/operations";
import { db, withDedicatedLockConnection, type DbTransaction } from "@/db";
import { apiKeys, apiKeyOwners, members, users } from "@/db/schema";
import { auth } from "@/lib/auth/better-auth";
import type { OrgContext } from "@/lib/auth/server";
import { canOwnApiKey, scopesFromStoredPermissions, serializeApiPermissions, toApiPermissions } from "@/lib/auth/api-scopes";
import { DomainError, idempotencyInProgress } from "@/lib/domain-errors";
import { revokeApiKeySchema, createApiKeySchema, updateApiKeySchema } from "@/schemas/api-keys";
import { claimIdempotencyKey, recordIdempotencyOutcome } from "./api-idempotency-records";
import { findApiCredentialMember } from "./api-credential-auth";
import { assertRowVersion, nextVersion } from "./row-version";
import { requireOrgScope } from "./utils";

const CREATE_API_KEY_OPERATION = "create_api_key";
// A draft retry replaces the key even when its name or scopes were edited.
const CREATE_API_KEY_FINGERPRINT = createHash("sha256").update(CREATE_API_KEY_OPERATION).digest("hex");
const createdKeyOutcomeSchema = z.object({ id: z.string().min(1) });

async function requireCredentialManager(ctx: OrgContext) {
  requireOrgScope(ctx);
  const member = await findApiCredentialMember(ctx.organizationId, ctx.userId);
  if (!member || !canOwnApiKey(member.role) || !member.emailVerified) {
    throw new DomainError("forbidden", "A verified organization Owner or Admin is required.");
  }
  return member;
}

export async function listApiKeys(ctx: OrgContext) {
  requireOrgScope(ctx);
  await requireCredentialManager(ctx);
  const rows = await db.select({
    id: apiKeys.id,
    name: apiKeys.name,
    ownerId: apiKeyOwners.userId,
    version: apiKeyOwners.version,
    ownerName: users.name,
    permissions: apiKeys.permissions,
    createdAt: apiKeys.createdAt,
    lastUsedAt: apiKeys.lastRequest,
    expiresAt: apiKeys.expiresAt,
    enabled: apiKeys.enabled,
    revokedAt: apiKeyOwners.revokedAt,
    currentMemberId: members.id,
  })
    .from(apiKeys)
    .innerJoin(apiKeyOwners, eq(apiKeyOwners.credentialId, apiKeys.id))
    .innerJoin(users, eq(users.id, apiKeyOwners.userId))
    .leftJoin(members, and(
      eq(members.id, apiKeyOwners.memberId),
      eq(members.organizationId, apiKeyOwners.organizationId),
      eq(members.userId, apiKeyOwners.userId),
    ))
    .where(and(eq(apiKeys.referenceId, ctx.organizationId), eq(apiKeyOwners.organizationId, ctx.organizationId)))
    .orderBy(desc(apiKeys.createdAt), apiKeys.id);
  return rows.map(({ permissions, revokedAt, currentMemberId, ...row }) => ({
    ...row,
    enabled: row.enabled && !revokedAt && currentMemberId !== null,
    permissions: toApiPermissions(scopesFromStoredPermissions(permissions)),
  }));
}

export async function createApiKey(ctx: OrgContext, input: unknown, intentKey?: string) {
  requireOrgScope(ctx);
  const member = await requireCredentialManager(ctx);
  const parsed = createApiKeySchema.parse(input);
  let issuedId: string | undefined;

  const issue = async () => {
    const result = await auth.api.createApiKey({
      body: {
        name: parsed.name,
        expiresIn: parsed.expiresIn,
        permissions: toApiPermissions(parsed.scopes),
        userId: ctx.userId,
        organizationId: ctx.organizationId,
      },
    });
    issuedId = result.id;
    return { id: result.id, key: result.key, name: result.name, expiresAt: result.expiresAt };
  };
  const bindOwner = async (executor: Pick<typeof db, "insert" | "select">, result: Awaited<ReturnType<typeof issue>>) => {
    await executor.insert(apiKeyOwners).values({
      credentialId: result.id,
      userId: ctx.userId,
      organizationId: ctx.organizationId,
      memberId: member.id,
    });
    // Keyed issuance re-checks through its transaction while holding the member lock.
    const currentMember = intentKey
      ? (await executor.select({ id: members.id, role: members.role, emailVerified: users.emailVerified })
        .from(members)
        .innerJoin(users, eq(users.id, members.userId))
        .where(and(eq(members.organizationId, ctx.organizationId), eq(members.userId, ctx.userId)))
        .limit(1))[0]
      : await requireCredentialManager(ctx);
    if (!currentMember || currentMember.id !== member.id
      || !canOwnApiKey(currentMember.role) || !currentMember.emailVerified) {
      throw new DomainError("forbidden", "Credential owner membership changed during issuance.");
    }
    return result;
  };

  try {
    if (!intentKey) return await bindOwner(db, await issue());
    return await withDedicatedLockConnection(async (tx) => {
      const credentialId = `${APP_FORM_CREDENTIAL_PREFIX}${ctx.userId}`;
      const lockKey = JSON.stringify([CREATE_API_KEY_OPERATION, ctx.organizationId, credentialId, intentKey]);
      // Reject overlap before claiming: waiting could replace a key that the
      // in-flight request is about to return. The lock lasts through commit.
      const lock = await tx.execute<{ acquired: boolean }>(
        sql`select pg_try_advisory_xact_lock(hashtextextended(${lockKey}, 0)) as acquired`,
      );
      if (!lock.rows[0]?.acquired) throw idempotencyInProgress();
      const claim = await claimIdempotencyKey(ctx, tx, {
        credentialId,
        key: intentKey,
        operationId: CREATE_API_KEY_OPERATION,
        fingerprint: CREATE_API_KEY_FINGERPRINT,
      });
      // Hold no member/previous-key row locks while Better Auth uses the pool:
      // its membership writes or expired-key cleanup could otherwise wait on us.
      const result = await issue();
      // After pooled issuance, serialize role updates/deletes with owner visibility.
      // Member first, then key rows: the membership writers lock in that order.
      const [lockedMember] = await tx.select({ id: members.id }).from(members)
        .where(and(eq(members.id, member.id), eq(members.organizationId, ctx.organizationId), eq(members.userId, ctx.userId)))
        .for("no key update");
      if (!lockedMember) {
        throw new DomainError("forbidden", "Credential owner membership changed during issuance.");
      }
      if (claim.kind === "replay") {
        const previous = createdKeyOutcomeSchema.parse(claim.outcome);
        await tx.delete(apiKeys).where(and(
          eq(apiKeys.id, previous.id), eq(apiKeys.referenceId, ctx.organizationId),
        ));
      }
      await bindOwner(tx, result);
      await recordIdempotencyOutcome(ctx, tx, claim.recordId, { id: result.id });
      return result;
    });
  } catch (error) {
    // Better Auth commits independently. Compensate after T rolls back, including
    // commit failures, without changing the previous key or its recorded outcome.
    if (issuedId) {
      await db.update(apiKeys).set({ enabled: false }).where(and(
        eq(apiKeys.id, issuedId), eq(apiKeys.referenceId, ctx.organizationId),
      ));
    }
    throw error;
  }
}

async function requireOwnedCredential(ctx: OrgContext, tx: DbTransaction, id: string, expectedVersion: number) {
  requireOrgScope(ctx);
  const [row] = await tx.select({ version: apiKeyOwners.version, revokedAt: apiKeyOwners.revokedAt })
    .from(apiKeyOwners)
    .innerJoin(apiKeys, eq(apiKeys.id, apiKeyOwners.credentialId))
    .where(and(eq(apiKeys.id, id), eq(apiKeys.referenceId, ctx.organizationId),
      eq(apiKeyOwners.organizationId, ctx.organizationId)))
    .for("update", { of: apiKeyOwners });
  if (!row) throw new DomainError("not_found", "Credential not found.");
  assertRowVersion({ entity: "api-key", id, expectedVersion, actualVersion: row.version });
  return row;
}

export async function updateApiKey(ctx: OrgContext, input: unknown) {
  requireOrgScope(ctx);
  await requireCredentialManager(ctx);
  const parsed = updateApiKeySchema.parse(input);
  await db.transaction(async (tx) => {
    await requireOwnedCredential(ctx, tx, parsed.id, parsed.expectedVersion);
    await tx.update(apiKeys)
      .set({ name: parsed.name, permissions: serializeApiPermissions(parsed.scopes), updatedAt: new Date() })
      .where(and(eq(apiKeys.id, parsed.id), eq(apiKeys.referenceId, ctx.organizationId)));
    await tx.update(apiKeyOwners)
      .set({ version: nextVersion(apiKeyOwners.version) })
      .where(and(eq(apiKeyOwners.credentialId, parsed.id), eq(apiKeyOwners.organizationId, ctx.organizationId)));
  });
  return { id: parsed.id };
}

export async function revokeApiKey(ctx: OrgContext, input: unknown) {
  requireOrgScope(ctx);
  await requireCredentialManager(ctx);
  const { id, expectedVersion } = revokeApiKeySchema.parse(input);
  await db.transaction(async (tx) => {
    const row = await requireOwnedCredential(ctx, tx, id, expectedVersion);
    // Disable, never delete: keep attribution and the management record.
    await tx.update(apiKeys)
      .set({ enabled: false, updatedAt: new Date() })
      .where(and(eq(apiKeys.id, id), eq(apiKeys.referenceId, ctx.organizationId)));
    await tx.update(apiKeyOwners)
      .set({
        version: nextVersion(apiKeyOwners.version),
        ...(!row.revokedAt ? { revokedAt: new Date(), revocationReason: "credential_revoked" } : {}),
      })
      .where(and(eq(apiKeyOwners.credentialId, id), eq(apiKeyOwners.organizationId, ctx.organizationId)));
  });
  return { id };
}
