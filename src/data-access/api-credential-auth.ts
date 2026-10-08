import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { apiKeys, apiKeyOwners, members, users } from "@/db/schema";
import { nextVersion } from "./row-version";

// org-scope-ok: pre-authentication hash lookup establishes the credential organization, never accepts client authority.
export async function findApiCredential(keyHash: string) {
  const [row] = await db.select({
    key: apiKeys,
    owner: apiKeyOwners,
  })
    .from(apiKeys)
    .innerJoin(apiKeyOwners, and(
      eq(apiKeys.id, apiKeyOwners.credentialId),
      eq(apiKeys.referenceId, apiKeyOwners.organizationId),
    ))
    .where(eq(apiKeys.key, keyHash))
    .limit(1);
  return row;
}

// org-scope-ok: resolver and issuance guard read live identity before trusting an OrgContext.
export async function findApiCredentialMember(organizationId: string, userId: string) {
  const [row] = await db.select({
    id: members.id,
    role: members.role,
    emailVerified: users.emailVerified,
  })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(and(eq(members.organizationId, organizationId), eq(members.userId, userId)))
    .limit(1);
  return row;
}

// org-scope-ok: trusted Better Auth membership hooks revoke only the affected organization/user's credentials.
export async function disableOwnerApiKeys(organizationId: string, userId: string, transaction?: DbTransaction) {
  const disable = async (tx: DbTransaction) => {
    await tx.update(apiKeyOwners)
      .set({
        version: nextVersion(apiKeyOwners.version),
        revokedAt: new Date(),
        revocationReason: "credential_owner_removed",
      })
      .where(and(eq(apiKeyOwners.organizationId, organizationId), eq(apiKeyOwners.userId, userId), isNull(apiKeyOwners.revokedAt)));
    await tx.update(apiKeys)
      .set({
        enabled: false,
        updatedAt: new Date(),
      })
      .where(and(
        eq(apiKeys.referenceId, organizationId),
        inArray(apiKeys.id, tx.select({ id: apiKeyOwners.credentialId })
          .from(apiKeyOwners)
          .where(and(eq(apiKeyOwners.organizationId, organizationId), eq(apiKeyOwners.userId, userId)))),
      ));
  };
  if (transaction) await disable(transaction);
  else await db.transaction(disable);
}
