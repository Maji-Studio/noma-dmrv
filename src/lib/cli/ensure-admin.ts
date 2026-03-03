/**
 * Ensures the admin user exists with a valid credential account.
 * Creates the user if missing, or updates the password hash if it already exists.
 * Does NOT seed any entity data — use `pnpm db:seed` for that.
 */
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { config } from 'dotenv';
import { Pool } from 'pg';
import * as schema from '../../db/schema';
import { hashPassword } from '../../../tests/e2e/fixtures/hash-password';

config({ path: '.env.local' });

const ADMIN_PASSWORD = 'admin123';

async function ensureAdmin() {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) {
    console.error('ERROR: ADMIN_EMAIL environment variable is not set');
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL environment variable is not set');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });

  try {
    const passwordHash = await hashPassword(ADMIN_PASSWORD);

    // Check if user exists
    const [existing] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, adminEmail))
      .limit(1);

    if (existing) {
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
      // Create user + credential account
      const userId = crypto.randomUUID();
      await db.insert(schema.users).values({
        id: userId,
        email: adminEmail,
        name: 'Admin',
        role: 'admin',
        emailVerified: true,
      });
      await db.insert(schema.accounts).values({
        id: `admin-account-${Date.now()}`,
        userId,
        accountId: `admin-${userId}`,
        providerId: 'credential',
        password: passwordHash,
      });
      console.log(`Created admin user ${adminEmail}`);
    }
  } finally {
    await pool.end();
  }
}

ensureAdmin().catch((err) => {
  console.error('Failed to ensure admin:', err);
  process.exit(1);
});
