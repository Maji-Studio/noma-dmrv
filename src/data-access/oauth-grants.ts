import { and, desc, eq, isNull } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { members, users, oauthClients, oauthConsents, oauthGrants } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { oauthRolePolicy } from "@/lib/auth/oauth-role-policy";
import { DomainError } from "@/lib/domain-errors";
import { revokeOAuthGrantSchema } from "@/schemas/oauth";
import { revokeGeneration } from "./oauth-grant-lifecycle";
import { assertRowVersion } from "./row-version";
import { requireOrgScope } from "./utils";

async function requireManager(ctx: OrgContext, executor: typeof db | DbTransaction = db) {
  requireOrgScope(ctx);
  const [member] = await executor.select({ role: members.role }).from(members)
    .where(and(eq(members.organizationId, ctx.organizationId), eq(members.userId, ctx.userId)));
  const policy = oauthRolePolicy(member?.role ?? "");
  if (!policy.manageOwn) throw new DomainError("forbidden", "Organization membership is required.");
  return policy;
}

async function listGrants(ctx: OrgContext, all: boolean) {
  requireOrgScope(ctx);
  const policy = await requireManager(ctx);
  if (all && !policy.manageAll) throw new DomainError("forbidden", "An organization Owner or Admin is required.");
  return db.select({ id: oauthGrants.id, userId: oauthGrants.userId, clientId: oauthGrants.clientId,
    name: oauthClients.name, memberName: users.name, resource: oauthGrants.resource, scopes: oauthConsents.scopes,
    createdAt: oauthGrants.createdAt, lastUsedAt: oauthGrants.lastUsedAt, version: oauthGrants.version })
    .from(oauthGrants)
    .innerJoin(users, eq(users.id, oauthGrants.userId))
    .innerJoin(oauthClients, eq(oauthClients.clientId, oauthGrants.clientId))
    .innerJoin(oauthConsents, and(eq(oauthConsents.referenceId, oauthGrants.id),
      eq(oauthConsents.clientId, oauthGrants.clientId), eq(oauthConsents.userId, oauthGrants.userId)))
    .innerJoin(members, and(eq(members.id, oauthGrants.memberId),
      eq(members.organizationId, oauthGrants.organizationId), eq(members.userId, oauthGrants.userId)))
    .where(and(eq(oauthGrants.organizationId, ctx.organizationId), isNull(oauthGrants.revokedAt),
      all ? undefined : eq(oauthGrants.userId, ctx.userId)))
    .orderBy(desc(oauthGrants.lastUsedAt), oauthGrants.id);
}

export async function listOwnOAuthGrants(ctx: OrgContext) {
  requireOrgScope(ctx);
  return listGrants(ctx, false);
}
export async function listAllOAuthGrants(ctx: OrgContext) {
  requireOrgScope(ctx);
  return listGrants(ctx, true);
}
export async function revokeOAuthGrant(ctx: OrgContext, input: unknown) {
  requireOrgScope(ctx);
  const { id, expectedVersion } = revokeOAuthGrantSchema.parse(input);
  await db.transaction(async tx => {
    const policy = await requireManager(ctx, tx);
    const [grant] = await tx.select().from(oauthGrants)
      .where(and(eq(oauthGrants.id, id), eq(oauthGrants.organizationId, ctx.organizationId))).for("update");
    if (!grant) throw new DomainError("not_found", "Connection not found.");
    if (grant.userId !== ctx.userId && !policy.manageAll) {
      throw new DomainError("forbidden", "You can only disconnect your own apps.");
    }
    assertRowVersion({ entity: "oauth-grant", id, expectedVersion, actualVersion: grant.version });
    await revokeGeneration(id, "disconnected", tx);
  });
  return { id };
}
