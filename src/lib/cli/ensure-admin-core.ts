/**
 * Testable core for the admin and default-organization bootstrap.
 * Does not load dotenv or self-execute; the adjacent CLI entrypoint owns both.
 */
import { and, eq, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../../db/schema';
import { DEC_ORG_ID, DEC_ORG_NAME, DEC_ORG_SLUG } from '../../db/org-defaults';
import { hashPassword } from '../auth/hash-password';
import { encryptSecret } from '../crypto/secrets';
import { getPgPoolConfig } from '../pg-pool-config';

export type EnsureAdminDb = NodePgDatabase<typeof schema>;

// Fixed bootstrap identifiers so reseeds are stable across environments.
// A dev teammate (org member, not admin) gives local member-management flows a
// second member to change roles on or remove.
const TEAMMATE_EMAIL = 'teammate@darkearthcarbon.dev';
const TEAMMATE_NAME = 'Dev Teammate';
const CREDENTIAL_PROVIDER = 'credential';

interface AdminCredentialResult {
  userId: string;
  passwordHash: string | null;
}

/**
 * Ensure the default organization exists and the Platform Admin has no member
 * row. Local/test resets also create a dev teammate Owner; production never
 * creates shared credentials and relies on invitations for the first real Owner.
 */
export async function ensureOrgFoundation(
  db: EnsureAdminDb,
  adminUserId: string,
  passwordHash: string,
): Promise<void> {
  await db
    .insert(schema.organizations)
    .values({ id: DEC_ORG_ID, name: DEC_ORG_NAME, slug: DEC_ORG_SLUG })
    .onConflictDoNothing({ target: schema.organizations.id });

  // Platform Admin authority comes from users.role only.
  await db
    .delete(schema.members)
    .where(
      and(
        eq(schema.members.organizationId, DEC_ORG_ID),
        eq(schema.members.userId, adminUserId),
      ),
    );

  if (process.env.NODE_ENV === 'production') {
    console.log(
      `Skipping dev teammate in production organizationId=${DEC_ORG_ID}`,
    );
    return;
  }

  let [teammate] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, TEAMMATE_EMAIL))
    .limit(1);

  if (!teammate) {
    const teammateId = crypto.randomUUID();
    await db.transaction(async (tx) => {
      await tx.insert(schema.users).values({
        id: teammateId,
        email: TEAMMATE_EMAIL,
        name: TEAMMATE_NAME,
        role: 'user',
        emailVerified: true,
      });
      await tx.insert(schema.accounts).values({
        id: `teammate-account-${Date.now()}`,
        userId: teammateId,
        accountId: `teammate-${teammateId}`,
        providerId: CREDENTIAL_PROVIDER,
        password: passwordHash,
      });
    });
    teammate = { id: teammateId };
    console.log(`Created dev teammate user userId=${teammateId}`);
  }

  const [teammateMembership] = await db
    .select({ id: schema.members.id, role: schema.members.role })
    .from(schema.members)
    .where(
      and(
        eq(schema.members.organizationId, DEC_ORG_ID),
        eq(schema.members.userId, teammate.id),
      ),
    )
    .limit(1);
  if (!teammateMembership) {
    await db.insert(schema.members).values({
      id: crypto.randomUUID(),
      organizationId: DEC_ORG_ID,
      userId: teammate.id,
      role: 'owner',
    });
  } else if (teammateMembership.role !== 'owner') {
    await db
      .update(schema.members)
      .set({ role: 'owner' })
      .where(eq(schema.members.id, teammateMembership.id));
  }

  console.log(
    `Ensured organization organizationId=${DEC_ORG_ID} with teammate owner`,
  );
}

export async function ensureIsometricCredentials(
  db: EnsureAdminDb,
): Promise<void> {
  const requiredValues = {
    ISOMETRIC_ACCESS_TOKEN: process.env.ISOMETRIC_ACCESS_TOKEN,
    ISOMETRIC_CLIENT_SECRET: process.env.ISOMETRIC_CLIENT_SECRET,
    CREDENTIALS_ENCRYPTION_KEY: process.env.CREDENTIALS_ENCRYPTION_KEY,
  };
  const missingNames = Object.entries(requiredValues)
    .filter(([, value]) => !value?.trim())
    .map(([name]) => name);

  if (missingNames.length > 0) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        `Missing or blank required environment variables: ${missingNames.join(', ')}`,
      );
    }
    console.log('Isometric credentials configured=false');
    return;
  }

  const accessToken = requiredValues.ISOMETRIC_ACCESS_TOKEN as string;
  const clientSecret = requiredValues.ISOMETRIC_CLIENT_SECRET as string;
  const accessTokenEncrypted = encryptSecret(accessToken);
  const clientSecretEncrypted = encryptSecret(clientSecret);
  const values = {
    organizationId: DEC_ORG_ID,
    provider: 'isometric' as const,
    accessTokenEncrypted,
    clientSecretEncrypted,
  };

  if (process.env.NODE_ENV === 'production') {
    // Production values are bootstrap-only. Later operator rotations in the app
    // must not be replaced by the original 1Password bootstrap pair.
    await db
      .insert(schema.certifierCredentials)
      .values(values)
      .onConflictDoNothing({
        target: [
          schema.certifierCredentials.organizationId,
          schema.certifierCredentials.provider,
        ],
      });
  } else {
    await db
      .insert(schema.certifierCredentials)
      .values(values)
      .onConflictDoUpdate({
        target: [
          schema.certifierCredentials.organizationId,
          schema.certifierCredentials.provider,
        ],
        set: {
          accessTokenEncrypted,
          clientSecretEncrypted,
          updatedAt: sql`now()`,
        },
      });
  }
  console.log('Isometric bootstrap credentials ensured=true');
}

async function ensureAdminCredential(
  db: EnsureAdminDb,
  adminEmail: string,
  adminPassword: string,
): Promise<AdminCredentialResult> {
  const [existing] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, adminEmail))
    .limit(1);

  if (existing) {
    const [account] = await db
      .select({ id: schema.accounts.id })
      .from(schema.accounts)
      .where(
        and(
          eq(schema.accounts.userId, existing.id),
          eq(schema.accounts.providerId, CREDENTIAL_PROVIDER),
        ),
      )
      .limit(1);

    if (account && process.env.NODE_ENV === 'production') {
      console.log(
        `Admin credential account already exists, password unchanged userId=${existing.id}`,
      );
      return { userId: existing.id, passwordHash: null };
    }

    const passwordHash = await hashPassword(adminPassword);
    if (account) {
      await db
        .update(schema.accounts)
        .set({ password: passwordHash })
        .where(eq(schema.accounts.id, account.id));
    } else {
      await db.insert(schema.accounts).values({
        id: `admin-account-${Date.now()}`,
        userId: existing.id,
        accountId: `admin-${existing.id}`,
        providerId: CREDENTIAL_PROVIDER,
        password: passwordHash,
      });
    }
    console.log(`Updated admin credentials userId=${existing.id}`);
    return { userId: existing.id, passwordHash };
  }

  const passwordHash = await hashPassword(adminPassword);
  const adminUserId = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(schema.users).values({
      id: adminUserId,
      email: adminEmail,
      name: 'Admin',
      role: 'admin',
      emailVerified: true,
    });
    await tx.insert(schema.accounts).values({
      id: `admin-account-${Date.now()}`,
      userId: adminUserId,
      accountId: `admin-${adminUserId}`,
      providerId: CREDENTIAL_PROVIDER,
      password: passwordHash,
    });
  });
  console.log(`Created admin user userId=${adminUserId}`);
  return { userId: adminUserId, passwordHash };
}

/** Ensure the admin user and its credential account, returning the user ID. */
export async function ensureAdminUser(
  db: EnsureAdminDb,
  adminEmail: string,
  adminPassword: string,
): Promise<string> {
  const result = await ensureAdminCredential(db, adminEmail, adminPassword);
  return result.userId;
}

function requireEnvironmentVariable(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) {
    throw new Error(`${name} environment variable is not set or is blank`);
  }
  return value;
}

/** Validate the CLI environment, connect, and run the complete bootstrap. */
export async function runEnsureAdmin(): Promise<void> {
  const adminEmail = requireEnvironmentVariable('ADMIN_EMAIL');
  const adminPassword = requireEnvironmentVariable('ADMIN_PASSWORD');
  const databaseUrl = requireEnvironmentVariable('DATABASE_URL');
  const pool = new Pool(getPgPoolConfig(databaseUrl));
  const db = drizzle(pool, { schema });

  try {
    const admin = await ensureAdminCredential(db, adminEmail, adminPassword);
    // A production foundation never consumes this hash because it skips the dev
    // teammate. Non-production creates/updates always return the computed hash.
    await ensureOrgFoundation(db, admin.userId, admin.passwordHash ?? '');
    await ensureIsometricCredentials(db);
  } finally {
    await pool.end();
  }
}
