import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { apiKeys, apiKeyOwners, members } from "@/db/schema";

/** Names and creation dates only, for a trusted account-security notice. */
// org-scope-ok: password notices list the recipient's own active keys across organizations.
export async function listActiveAccountApiKeys(userId: string) {
  return db.select({ name: apiKeys.name, createdAt: apiKeys.createdAt })
    .from(apiKeys)
    .innerJoin(apiKeyOwners, and(eq(apiKeyOwners.credentialId, apiKeys.id),
      eq(apiKeyOwners.organizationId, apiKeys.referenceId)))
    .innerJoin(members, and(eq(members.id, apiKeyOwners.memberId),
      eq(members.organizationId, apiKeyOwners.organizationId), eq(members.userId, apiKeyOwners.userId)))
    .where(and(eq(apiKeyOwners.userId, userId), eq(apiKeys.enabled, true), isNull(apiKeyOwners.revokedAt),
      or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, new Date()))))
    .orderBy(desc(apiKeys.createdAt), apiKeys.id);
}
