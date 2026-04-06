import { Pool } from 'pg';
import { config } from 'dotenv';

// Load environment variables from .env.local
config({ path: '.env.local' });

async function resetDatabase(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error('✗ DATABASE_URL environment variable not set');
    process.exit(1);
  }

  const isLocal = process.env.DATABASE_URL.includes('localhost') || process.env.DATABASE_URL.includes('127.0.0.1');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
  });

  try {
    console.log('🗑️  Dropping application and migration schemas...');

    // Drop application objects and Drizzle migration metadata so the database
    // can be rebuilt cleanly from the first tracked migration.
    await pool.query(`DROP SCHEMA IF EXISTS drizzle CASCADE`);
    await pool.query(`DROP SCHEMA public CASCADE`);

    await pool.query(`CREATE SCHEMA public`);

    // Restore default grants
    await pool.query(`GRANT ALL ON SCHEMA public TO current_user`);
    await pool.query(`GRANT ALL ON SCHEMA public TO public`);

    console.log('  ✓ Schema reset complete\n');

    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Reset failed:', error);
    await pool.end();
    process.exit(1);
  }
}

resetDatabase();
