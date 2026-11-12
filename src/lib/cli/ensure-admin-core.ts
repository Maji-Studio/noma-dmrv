/**
 * Testable core for the admin and default-organization bootstrap.
 * Does not load dotenv or self-execute; the adjacent CLI entrypoint owns both.
 */
import { and, eq, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../../db/schema';
import { DEC_ORG_ID, DEC_ORG_NAME, DEC_ORG_SLUG } from '../../db/org-defaults';
import { hashPassword } from 'better-auth/crypto';
import { encryptSecret } from '../crypto/secrets';
import { getPgPoolConfig, isLocalDatabaseTarget } from '../pg-pool-config';
import { AUTH_PASSWORD_MIN_LENGTH, AUTH_PASSWORD_MAX_LENGTH } from '../../config/auth';
import {
  DEV_BOOTSTRAP_OVERRIDE,
  PRODUCTION_NODE_ENV,
} from '../../config/bootstrap';

export type EnsureAdminDb = NodePgDatabase<typeof schema>;

// Fixed bootstrap identifiers so reseeds are stable across environments.
// A dev teammate is an organization Admin, not a Platform Admin, so local
// sessions can exercise organization management without platform privileges.
const TEAMMATE_EMAIL = 'teammate@darkearthcarbon.dev';
const TEAMMATE_NAME = 'Dev Teammate';
const CREDENTIAL_PROVIDER = 'credential';

interface BootstrapEnvironment {
  NODE_ENV?: string;
  DATABASE_URL?: string;
  ALLOW_DEV_BOOTSTRAP?: string;
}

interface AdminCredentialResult {
  userId: string;
  passwordHash: string;
}

/** Refuse production and require an explicit override for remote development. */
export function assertDevelopmentBootstrapAllowed(
  environment: BootstrapEnvironment = process.env,
): void {
  if (environment.NODE_ENV === PRODUCTION_NODE_ENV) {
    throw new Error('Admin CLI bootstrap is for local development, CI, and seeded staging only. Open /setup to choose the first Platform Admin in production.');
  }

  const databaseUrl = environment.DATABASE_URL;
  if (!databaseUrl?.trim()) {
    throw new Error('DATABASE_URL environment variable is not set or is blank');
  }

  let isLocal: boolean;
  try {
    isLocal = isLocalDatabaseTarget(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL environment variable is not a valid URL');
  }

  if (isLocal) return;
  if (environment.ALLOW_DEV_BOOTSTRAP === DEV_BOOTSTRAP_OVERRIDE) {
    return;
  }

  throw new Error(
    'Refusing development bootstrap against a non-local database. Use ALLOW_DEV_BOOTSTRAP=1 only for an intentional development bootstrap; use /setup for a plain first run.',
  );
}

/**
 * Ensure the default organization exists and remove the Platform Admin member
 * row after ensuring a dev teammate Admin for local development, CI and seeded staging.
 */
export async function ensureOrgFoundation(
  db: EnsureAdminDb,
  adminUserId: string,
  passwordHash: string,
): Promise<void> {
  assertDevelopmentBootstrapAllowed();
  await db
    .insert(schema.organizations)
    .values({ id: DEC_ORG_ID, name: DEC_ORG_NAME, slug: DEC_ORG_SLUG })
    .onConflictDoNothing({ target: schema.organizations.id });

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
        accountId: teammateId,
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
      role: 'admin',
    });
  } else if (teammateMembership.role !== 'admin') {
    await db
      .update(schema.members)
      .set({ role: 'admin' })
      .where(eq(schema.members.id, teammateMembership.id));
  }

  await db.delete(schema.members).where(and(
    eq(schema.members.organizationId, DEC_ORG_ID),
    eq(schema.members.userId, adminUserId),
  ));

  console.log(
    `Ensured organization organizationId=${DEC_ORG_ID} with teammate admin`,
  );
}

export async function ensureIsometricCredentials(
  db: EnsureAdminDb,
): Promise<void> {
  assertDevelopmentBootstrapAllowed();
  const requiredValues = {
    ISOMETRIC_ACCESS_TOKEN: process.env.ISOMETRIC_ACCESS_TOKEN,
    ISOMETRIC_CLIENT_SECRET: process.env.ISOMETRIC_CLIENT_SECRET,
    CREDENTIALS_ENCRYPTION_KEY: process.env.CREDENTIALS_ENCRYPTION_KEY,
  };
  const missingNames = Object.entries(requiredValues)
    .filter(([, value]) => !value?.trim())
    .map(([name]) => name);

  if (missingNames.length > 0) {
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
  console.log('Isometric bootstrap credentials ensured=true');
}

function validatePassword(name: string, password: string): void {
  if (
    password.length < AUTH_PASSWORD_MIN_LENGTH ||
    password.length > AUTH_PASSWORD_MAX_LENGTH
  ) {
    throw new Error(
      `${name} must be between ${AUTH_PASSWORD_MIN_LENGTH} and ${AUTH_PASSWORD_MAX_LENGTH} characters`,
    );
  }
}

async function ensureAdminCredential(
  db: EnsureAdminDb,
  adminEmail: string,
  adminPassword: string,
): Promise<AdminCredentialResult> {
  // The dev teammate reuses this hash, so validate before either credential is written.
  validatePassword('ADMIN_PASSWORD', adminPassword);
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
        accountId: existing.id,
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
      accountId: adminUserId,
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
  assertDevelopmentBootstrapAllowed();
  const result = await ensureAdminCredential(
    db,
    adminEmail,
    adminPassword,
  );
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
  assertDevelopmentBootstrapAllowed();
  const adminEmail = requireEnvironmentVariable('ADMIN_EMAIL');
  const adminPassword = requireEnvironmentVariable('ADMIN_PASSWORD');
  validatePassword('ADMIN_PASSWORD', adminPassword);
  const databaseUrl = requireEnvironmentVariable('DATABASE_URL');
  const pool = new Pool(getPgPoolConfig(databaseUrl));
  const db = drizzle(pool, { schema });

  try {
    const admin = await ensureAdminCredential(
      db,
      adminEmail,
      adminPassword,
    );
    await ensureOrgFoundation(db, admin.userId, admin.passwordHash);
    await ensureIsometricCredentials(db);
  } finally {
    await pool.end();
  }
}
