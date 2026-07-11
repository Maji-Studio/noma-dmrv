/**
 * Ensures the admin user exists with a valid credential account, plus a default
 * "Dark Earth Carbon" organization so local/dev flows keep working once the app
 * is org-scoped. Creates the user if missing, or updates the password hash if it
 * already exists. Does NOT seed any domain-entity data — use `pnpm db:seed`.
 */
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { config } from 'dotenv';
import { Pool } from 'pg';
import * as schema from '../../db/schema';
import { DEC_ORG_ID, DEC_ORG_NAME, DEC_ORG_SLUG } from '../../db/org-defaults';
import { hashPassword } from '../auth/hash-password';
import { getPgPoolConfig } from '../pg-pool-config';
import { encryptSecret } from '../crypto/secrets';

config({ path: '.env.local' });

type Db = ReturnType<typeof drizzle<typeof schema>>;

// Fixed bootstrap identifiers so reseeds are stable across environments.
// A dev teammate (org member, not admin) so member-management flows have a
// second member to change roles on / remove during local testing.
const TEAMMATE_EMAIL = 'teammate@darkearthcarbon.dev';
const TEAMMATE_NAME = 'Dev Teammate';

/**
 * Ensure the default organization exists, the Platform Admin has no member
 * row, and a dev teammate owns it. Idempotent on every `db:reset`.
 */
async function ensureOrgFoundation(
  db: Db,
  adminUserId: string,
  passwordHash: string
): Promise<void> {
  // 1. Organization row (fixed id).
  await db
    .insert(schema.organizations)
    .values({ id: DEC_ORG_ID, name: DEC_ORG_NAME, slug: DEC_ORG_SLUG })
    .onConflictDoNothing({ target: schema.organizations.id });

  // 2. Heal older seeds: Platform Admin authority comes from users.role only.
  await db
    .delete(schema.members)
    .where(
      and(
        eq(schema.members.organizationId, DEC_ORG_ID),
        eq(schema.members.userId, adminUserId)
      )
    );

  // 3. Dev teammate user + credential + Owner membership.
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
        providerId: 'credential',
        password: passwordHash,
      });
    });
    teammate = { id: teammateId };
    // No email in logs (PII rule) — the id is enough to correlate.
    console.log(`Created dev teammate user userId=${teammateId}`);
  }

  const [teammateMembership] = await db
    .select({ id: schema.members.id, role: schema.members.role })
    .from(schema.members)
    .where(
      and(
        eq(schema.members.organizationId, DEC_ORG_ID),
        eq(schema.members.userId, teammate.id)
      )
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

  console.log(`Ensured organization "${DEC_ORG_NAME}" with teammate owner`);
}

async function ensureIsometricCredentials(db: Db): Promise<void> {
  const accessToken = process.env.ISOMETRIC_ACCESS_TOKEN;
  const clientSecret = process.env.ISOMETRIC_CLIENT_SECRET;
  const encryptionKey = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!accessToken || !clientSecret || !encryptionKey) {
    console.log('Isometric credentials configured=false');
    return;
  }

  const accessTokenEncrypted = encryptSecret(accessToken);
  const clientSecretEncrypted = encryptSecret(clientSecret);
  await db
    .insert(schema.certifierCredentials)
    .values({
      organizationId: DEC_ORG_ID,
      provider: 'isometric',
      accessTokenEncrypted,
      clientSecretEncrypted,
    })
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
  console.log('Isometric credentials configured=true');
}

async function ensureAdmin() {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) {
    console.error('ERROR: ADMIN_EMAIL environment variable is not set');
    process.exit(1);
  }

  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    console.error('ERROR: ADMIN_PASSWORD environment variable is not set');
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL environment variable is not set');
    process.exit(1);
  }

  const pool = new Pool(getPgPoolConfig(process.env.DATABASE_URL));
  const db = drizzle(pool, { schema });

  try {
    const passwordHash = await hashPassword(adminPassword);

    // Check if user exists
    const [existing] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, adminEmail))
      .limit(1);

    let adminUserId: string;
    if (existing) {
      adminUserId = existing.id;
      // Update password hash
      const [account] = await db
        .select({ id: schema.accounts.id })
        .from(schema.accounts)
        .where(eq(schema.accounts.userId, existing.id))
        .limit(1);

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
          providerId: 'credential',
          password: passwordHash,
        });
      }
      console.log(`Updated admin credentials for ${adminEmail}`);
    } else {
      // Create user + credential account in a transaction
      adminUserId = crypto.randomUUID();
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
          providerId: 'credential',
          password: passwordHash,
        });
      });
      console.log(`Created admin user ${adminEmail}`);
    }

    await ensureOrgFoundation(db, adminUserId, passwordHash);
    await ensureIsometricCredentials(db);
  } finally {
    await pool.end();
  }
}

ensureAdmin().catch((err) => {
  console.error('Failed to ensure admin:', err);
  process.exit(1);
});
