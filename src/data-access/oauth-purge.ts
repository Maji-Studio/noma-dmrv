import { and, eq, gt, isNull, lt, lte, notExists } from "drizzle-orm";
import { db } from "@/db";
import { oauthAccessTokens, oauthAuthorizationAttempts, oauthClientAssertions, oauthConsents, oauthGrants, oauthRefreshTokens } from "@/db/schema";

const PENDING_RETENTION_MS = 24 * 60 * 60 * 1_000;

// org-scope-ok: system cron purges expired authorization attempts across organizations
export async function purgeExpiredOAuthAttempts(now = new Date()) {
  // org-scope-ok: system cron purges expired OAuth bookkeeping across organizations
  const rows = await db.delete(oauthAuthorizationAttempts).where(lte(oauthAuthorizationAttempts.expiresAt, now))
    .returning({ id: oauthAuthorizationAttempts.attemptKey });
  return rows.length;
}

// org-scope-ok: system cron purges unconsented pending generations across organizations
export async function purgePendingOAuthGrants(now = new Date()) {
  // org-scope-ok: system cron purges expired OAuth bookkeeping across organizations
  const rows = await db.delete(oauthGrants).where(and(isNull(oauthGrants.revokedAt),
    lt(oauthGrants.createdAt, new Date(now.getTime() - PENDING_RETENTION_MS)),
    // org-scope-ok: system cron preserves generations bound to live authorization attempts
    notExists(db.select({ id: oauthAuthorizationAttempts.attemptKey }).from(oauthAuthorizationAttempts)
      .where(and(eq(oauthAuthorizationAttempts.grantId, oauthGrants.id), gt(oauthAuthorizationAttempts.expiresAt, now)))),
    // org-scope-ok: system cron purges expired OAuth bookkeeping across organizations
    notExists(db.select({ id: oauthConsents.id }).from(oauthConsents).where(eq(oauthConsents.referenceId, oauthGrants.id))),
    // org-scope-ok: system cron purges expired OAuth bookkeeping across organizations
    notExists(db.select({ id: oauthAccessTokens.id }).from(oauthAccessTokens).where(eq(oauthAccessTokens.referenceId, oauthGrants.id))),
    // org-scope-ok: system cron purges expired OAuth bookkeeping across organizations
    notExists(db.select({ id: oauthRefreshTokens.id }).from(oauthRefreshTokens).where(eq(oauthRefreshTokens.referenceId, oauthGrants.id)))))
    .returning({ id: oauthGrants.id });
  return rows.length;
}

// org-scope-ok: system cron purges expired plugin tokens across organizations
export async function purgeExpiredOAuthTokens(now = new Date()) {
  return db.transaction(async tx => {
    // org-scope-ok: system cron purges expired OAuth bookkeeping across organizations
    const access = await tx.delete(oauthAccessTokens).where(lte(oauthAccessTokens.expiresAt, now)).returning({ id: oauthAccessTokens.id });
    // The plugin's refresh FK cascades. Retain expired parents while any access
    // token still needs its row for diagnostics, rather than deleting live tokens.
    // org-scope-ok: system cron purges expired OAuth bookkeeping across organizations
    const refresh = await tx.delete(oauthRefreshTokens).where(and(lte(oauthRefreshTokens.expiresAt, now),
      // org-scope-ok: system cron purges expired OAuth bookkeeping across organizations
      notExists(tx.select({ id: oauthAccessTokens.id }).from(oauthAccessTokens).where(eq(oauthAccessTokens.refreshId, oauthRefreshTokens.id)))))
      .returning({ id: oauthRefreshTokens.id });
    return { accessTokens: access.length, refreshTokens: refresh.length };
  });
}

// org-scope-ok: system cron purges expired platform client assertions
export async function purgeExpiredOAuthClientAssertions(now = new Date()) {
  // org-scope-ok: system cron purges expired OAuth bookkeeping across organizations
  const rows = await db.delete(oauthClientAssertions).where(lte(oauthClientAssertions.expiresAt, now)).returning({ id: oauthClientAssertions.id });
  return rows.length;
}
