import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { encryptSecret } from "@/lib/crypto/secrets";
import { TEST_SITE_POSITION } from "../../helpers/test-org";
import type { TestUser } from "./auth-fixtures";
import {
  E2E_CERTIFIER_ACCESS_TOKEN,
  E2E_CERTIFIER_CLIENT_SECRET,
  E2E_CERTIFIER_ORG_ID_PREFIX,
} from "./certifier-credentials";
import { createDbConnection } from "./db";

/** An isolated settings fixture, including credentials only when requested. */
export async function seedDedicatedOrg({
  role,
  withRegistryKeys,
}: {
  role: "admin" | "member";
  withRegistryKeys: boolean;
}) {
  const tag = randomUUID();
  const organizationId = `${E2E_CERTIFIER_ORG_ID_PREFIX}${tag}`;
  const organizationName = `E2E Settings Org ${tag}`;
  const accountId = `e2e-settings-account-${tag}`;
  const memberId = `e2e-settings-member-${tag}`;
  const facilityId = randomUUID();
  const credentialsId = randomUUID();
  const user: TestUser = {
    id: `e2e-settings-user-${tag}`,
    email: `settings-${tag}@e2e.local`,
    name: `E2E Settings ${role}`,
    role: "user",
    password: "TestPassword123!",
  };
  const { db, pool } = createDbConnection();
  try {
    const password = await hashPassword(user.password);
    await db.transaction(async (tx) => {
      await tx.insert(schema.organizations).values({
        id: organizationId,
        name: organizationName,
        slug: `e2e-settings-${tag}`,
      });
      await tx.insert(schema.users).values({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        emailVerified: true,
      });
      await tx.insert(schema.accounts).values({
        id: accountId,
        userId: user.id,
        accountId: user.id,
        providerId: "credential",
        password,
      });
      await tx.insert(schema.members).values({
        id: memberId,
        organizationId,
        userId: user.id,
        role,
      });
      await tx.insert(schema.facilities).values({
        id: facilityId,
        organizationId,
        code: `E2E-SETTINGS-${tag}`,
        name: `E2E Settings Facility ${tag}`,
        ...TEST_SITE_POSITION,
        timezone: "Africa/Dar_es_Salaam",
        durabilityOption: "200_year",
      });
      if (withRegistryKeys) {
        // The placeholder secret cannot form an HTTP header, keeping reads offline.
        await tx.insert(schema.certifierCredentials).values({
          id: credentialsId,
          organizationId,
          provider: "isometric",
          accessTokenEncrypted: encryptSecret(E2E_CERTIFIER_ACCESS_TOKEN),
          clientSecretEncrypted: encryptSecret(E2E_CERTIFIER_CLIENT_SECRET),
        });
      }
    });
  } catch (error) {
    await pool.end();
    throw error;
  }

  return {
    user,
    facilityId,
    organizationId,
    organizationName,
    async cleanup() {
      try {
        await db.transaction(async (tx) => {
          if (withRegistryKeys) {
            await tx.delete(schema.certifierCredentials).where(eq(schema.certifierCredentials.id, credentialsId));
          }
          await tx.delete(schema.facilities).where(eq(schema.facilities.id, facilityId));
          // The membership goes with the organization: deleting the only Admin
          // on its own is refused by the last-Admin trigger.
          await tx.delete(schema.organizations).where(eq(schema.organizations.id, organizationId));
          await tx.delete(schema.sessions).where(eq(schema.sessions.userId, user.id));
          await tx.delete(schema.accounts).where(eq(schema.accounts.id, accountId));
          await tx.delete(schema.users).where(eq(schema.users.id, user.id));
        });
      } finally {
        await pool.end();
      }
    },
  };
}
