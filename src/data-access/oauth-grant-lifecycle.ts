import { OAUTH_CODE_LIFETIME_MS, isOAuthGenerationIdle } from "@/config/oauth";
import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { members, oauthAuthorizationAttempts, oauthConsents, oauthGrants, organizationApiAccess, sessions, users, type OAuthGrant, type OAuthRevocationReason } from "@/db/schema";
import { DomainError } from "@/lib/domain-errors";
import { oauthRolePolicy } from "@/lib/auth/oauth-role-policy";
import { disableOwnerApiKeys } from "./api-credential-auth";
import { nextVersion } from "./row-version";

type AttemptIdentity = { attemptKey: string; sessionId: string; userId: string };
type AttemptSelection = AttemptIdentity & { organizationId: string };
type AttemptBinding = AttemptIdentity & { clientId: string; resource: string };
export type { OAuthRevocationReason } from "@/db/schema/oauth";

function refuseAttempt(): never {
  throw new DomainError("forbidden", "Start again from the app");
}

// org-scope-ok: session-authenticated authorization attempt; membership validated in the same query
async function lockEligibleMembership(tx: DbTransaction, input: { sessionId: string; userId: string; organizationId: string }, now: Date) {
  const [member] = await tx.select({ id: members.id, role: members.role })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .innerJoin(sessions, and(eq(sessions.userId, users.id), eq(sessions.id, input.sessionId)))
    .leftJoin(organizationApiAccess, eq(organizationApiAccess.organizationId, members.organizationId))
    .where(and(eq(members.organizationId, input.organizationId), eq(members.userId, input.userId),
      eq(users.emailVerified, true), gt(sessions.expiresAt, now),
      or(isNull(organizationApiAccess.enabled), eq(organizationApiAccess.enabled, true))))
    .for("no key update", { of: members });
  if (!member || !oauthRolePolicy(member.role).connect) refuseAttempt();
  return member;
}

/** Only trusted callers with a verified authorization query may supply its key. */
// org-scope-ok: session-authenticated authorization attempt; membership validated in the same query
export async function selectOAuthOrganization(input: AttemptSelection) {
  return db.transaction(async (tx) => {
    const now = new Date();
    const member = await lockEligibleMembership(tx, input, now);
    // org-scope-ok: session-authenticated authorization attempt; membership validated in the same query
    await tx.insert(oauthAuthorizationAttempts).values({
      attemptKey: input.attemptKey, sessionId: input.sessionId, userId: input.userId,
      organizationId: input.organizationId, memberId: member.id,
      createdAt: now, expiresAt: new Date(now.getTime() + OAUTH_CODE_LIFETIME_MS),
    }).onConflictDoNothing();
    // org-scope-ok: session-authenticated authorization attempt; membership validated in the same query
    const [attempt] = await tx.select().from(oauthAuthorizationAttempts)
      .where(eq(oauthAuthorizationAttempts.attemptKey, input.attemptKey));
    if (!attempt || attempt.sessionId !== input.sessionId || attempt.userId !== input.userId ||
      attempt.organizationId !== input.organizationId || attempt.memberId !== member.id || attempt.expiresAt <= now) refuseAttempt();
    return attempt;
  });
}

/** The caller derives client and resource from the same verified query as the key.
 * c3's eligibility guard must also run on the returned generation before issuance.
 */
// org-scope-ok: session-authenticated authorization attempt; membership validated in the same query
export async function resolveAttemptGrant(input: AttemptBinding) {
  return db.transaction(async (tx) => {
    const now = new Date();
    // org-scope-ok: session-authenticated authorization attempt; membership validated in the same query
    const [attempt] = await tx.select().from(oauthAuthorizationAttempts)
      .where(and(eq(oauthAuthorizationAttempts.attemptKey, input.attemptKey),
        eq(oauthAuthorizationAttempts.sessionId, input.sessionId), eq(oauthAuthorizationAttempts.userId, input.userId),
        gt(oauthAuthorizationAttempts.expiresAt, now)))
      .for("update");
    if (!attempt || (attempt.clientId !== null && attempt.clientId !== input.clientId) ||
      (attempt.resource !== null && attempt.resource !== input.resource)) refuseAttempt();
    const member = await lockEligibleMembership(tx, { ...input, organizationId: attempt.organizationId }, now);
    if (member.id !== attempt.memberId) refuseAttempt();
    const binding = and(eq(oauthGrants.organizationId, attempt.organizationId), eq(oauthGrants.userId, input.userId),
      eq(oauthGrants.clientId, input.clientId), eq(oauthGrants.resource, input.resource));
    if (attempt.grantId) {
      // org-scope-ok: session-authenticated authorization attempt; membership validated in the same query
      const [grant] = await tx.select().from(oauthGrants)
        .where(and(binding, eq(oauthGrants.id, attempt.grantId))).for("update");
      if (!grant || grant.revokedAt || grant.memberId !== member.id) refuseAttempt();
      return grant;
    }
    // The membership lock serializes first connections from different attempts.
    // org-scope-ok: session-authenticated authorization attempt; membership validated in the same query
    const existing = await tx.select().from(oauthGrants).where(and(binding, isNull(oauthGrants.revokedAt))).for("update");
    let grant: OAuthGrant | undefined = existing[0];
    if (grant && grant.memberId !== member.id) {
      await revokeGeneration(grant.id, "member_changed", tx);
      grant = undefined;
    }
    if (grant && isOAuthGenerationIdle(grant.lastUsedAt, now)) {
      await revokeGeneration(grant.id, "inactive", tx);
      grant = undefined;
    }
    if (!grant) {
      [grant] = await tx.insert(oauthGrants).values({ id: randomUUID(), organizationId: attempt.organizationId,
        userId: input.userId, memberId: member.id, clientId: input.clientId, resource: input.resource,
        createdAt: now, lastUsedAt: now }).returning();
    }
    await tx.update(oauthAuthorizationAttempts).set({ grantId: grant.id, clientId: input.clientId, resource: input.resource })
      .where(and(eq(oauthAuthorizationAttempts.attemptKey, attempt.attemptKey),
        eq(oauthAuthorizationAttempts.organizationId, attempt.organizationId)));
    return grant;
  });
}

// org-scope-ok: pre-authentication token lookup establishes the grant organization
export async function revokeGeneration(id: string, reason: OAuthRevocationReason, transaction?: DbTransaction) {
  const revoke = async (tx: DbTransaction) => {
    // org-scope-ok: pre-authentication token lookup establishes the grant organization
    await tx.update(oauthGrants).set({ revokedAt: new Date(), revocationReason: reason, version: nextVersion(oauthGrants.version) })
      .where(and(eq(oauthGrants.id, id), isNull(oauthGrants.revokedAt)));
    // Never change plugin token rows: revoked refresh rows can trigger family teardown.
    // org-scope-ok: pre-authentication token lookup establishes the grant organization
    await tx.delete(oauthConsents).where(eq(oauthConsents.referenceId, id));
  };
  if (transaction) await revoke(transaction);
  else await db.transaction(revoke);
}

// org-scope-ok: trusted membership hooks revoke only the affected organization/user generations
export async function revokeMemberOAuthGrants(organizationId: string, userId: string, removedMemberId: string, transaction?: DbTransaction) {
  const revoke = async (tx: DbTransaction) => {
    const grants = await tx.select({ id: oauthGrants.id }).from(oauthGrants)
      .where(and(eq(oauthGrants.organizationId, organizationId), eq(oauthGrants.userId, userId),
        or(eq(oauthGrants.memberId, removedMemberId), isNull(oauthGrants.memberId)), isNull(oauthGrants.revokedAt)))
      .orderBy(oauthGrants.id).for("update");
    for (const grant of grants) await revokeGeneration(grant.id, "member_removed", tx);
  };
  if (transaction) await revoke(transaction);
  else await db.transaction(revoke);
}

// org-scope-ok: trusted membership hooks revoke only the affected organization/user generations
// Revokes only when the named membership row is gone, so a forged or stale
// member id can never end a live member's connections.
export async function revokeDeletedMemberOAuthGrants(member: { id: string; organizationId: string; userId: string }) {
  await db.transaction(async tx => {
    const [live] = await tx.select({ id: members.id }).from(members).where(eq(members.id, member.id)).limit(1);
    if (live) return;
    await revokeMemberOAuthGrants(member.organizationId, member.userId, member.id, tx);
    await disableOwnerApiKeys(member.organizationId, member.userId, tx);
  });
}

// org-scope-ok: session-authenticated authorization attempt; membership validated in the same query
export async function getOAuthOrganizationSelection(input: { sessionId: string; userId: string; clientId: string; resource: string }) {
  const eligible = await db.select({ organizationId: members.organizationId, memberId: members.id, role: members.role })
    .from(members).innerJoin(users, eq(users.id, members.userId))
    .innerJoin(sessions, and(eq(sessions.userId, users.id), eq(sessions.id, input.sessionId)))
    .leftJoin(organizationApiAccess, eq(organizationApiAccess.organizationId, members.organizationId))
    .where(and(eq(members.userId, input.userId), eq(users.emailVerified, true), gt(sessions.expiresAt, new Date()),
      or(isNull(organizationApiAccess.enabled), eq(organizationApiAccess.enabled, true))));
  const memberships = eligible.filter(member => oauthRolePolicy(member.role).connect);
  if (memberships.length === 0) return { memberships, autoSelectOrganizationId: null, preselectedOrganizationId: null };
  const [recent] = await db.select({ organizationId: oauthGrants.organizationId })
    .from(oauthGrants).innerJoin(oauthConsents, and(eq(oauthConsents.referenceId, oauthGrants.id),
      eq(oauthConsents.clientId, oauthGrants.clientId), eq(oauthConsents.userId, oauthGrants.userId)))
    .innerJoin(members, and(eq(members.id, oauthGrants.memberId), eq(members.organizationId, oauthGrants.organizationId), eq(members.userId, oauthGrants.userId)))
    .innerJoin(sessions, and(eq(sessions.userId, members.userId), eq(sessions.id, input.sessionId)))
    .where(and(inArray(oauthGrants.organizationId, memberships.map(member => member.organizationId)), eq(oauthGrants.userId, input.userId), eq(oauthGrants.clientId, input.clientId), eq(oauthGrants.resource, input.resource),
      isNull(oauthGrants.revokedAt), gt(sessions.expiresAt, new Date())))
    .orderBy(desc(oauthGrants.lastUsedAt), oauthGrants.id).limit(1);
  return { memberships, autoSelectOrganizationId: memberships.length === 1 ? memberships[0].organizationId : null,
    preselectedOrganizationId: recent && memberships.some(member => member.organizationId === recent.organizationId) ? recent.organizationId : null };
}
