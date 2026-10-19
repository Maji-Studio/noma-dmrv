import { and, desc, eq } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { apiKeys, apiKeyOwners, members, users } from "@/db/schema";
import { auth } from "@/lib/auth/better-auth";
import type { OrgContext } from "@/lib/auth/server";
import { canOwnApiKey, scopesFromStoredPermissions, serializeApiPermissions, toApiPermissions } from "@/lib/auth/api-scopes";
import { DomainError } from "@/lib/domain-errors";
import { revokeApiKeySchema, createApiKeySchema, updateApiKeySchema } from "@/schemas/api-keys";
import { findApiCredentialMember } from "./api-credential-auth";
import { assertRowVersion, nextVersion } from "./row-version";
import { requireOrgScope } from "./utils";

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

export async function createApiKey(ctx: OrgContext, input: unknown) {
  requireOrgScope(ctx);
  const member = await requireCredentialManager(ctx);
  const parsed = createApiKeySchema.parse(input);
  const result = await auth.api.createApiKey({
    body: {
      name: parsed.name,
      expiresIn: parsed.expiresIn,
      permissions: toApiPermissions(parsed.scopes),
      userId: ctx.userId,
      organizationId: ctx.organizationId,
    },
  });
  try {
    await db.insert(apiKeyOwners)
      .values({
        credentialId: result.id,
        userId: ctx.userId,
        organizationId: ctx.organizationId,
        memberId: member.id,
      });
    // Close the membership-change/issuance race after the owner becomes visible
    // to revocation hooks. Unbound plugin rows are never accepted by the resolver.
    const currentMember = await requireCredentialManager(ctx);
    if (currentMember.id !== member.id) {
      throw new DomainError("forbidden", "Credential owner membership changed during issuance.");
    }
  } catch (error) {
    await db.update(apiKeys)
      .set({ enabled: false })
      .where(and(eq(apiKeys.id, result.id), eq(apiKeys.referenceId, ctx.organizationId)));
    throw error;
  }
  return {
    id: result.id,
    key: result.key,
    name: result.name,
    expiresAt: result.expiresAt,
  };
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
