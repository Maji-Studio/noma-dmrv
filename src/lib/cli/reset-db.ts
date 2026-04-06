import { Pool } from 'pg';
import { config } from 'dotenv';
import { describeDatabaseTarget, getPgPoolConfig } from '../pg-pool-config';

// Load environment variables from .env.local
config({ path: '.env.local' });

async function resetDatabase(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error('✗ DATABASE_URL environment variable not set');
    process.exit(1);
  }

  try {
    console.log(`Connection target: ${describeDatabaseTarget(process.env.DATABASE_URL)}`);
  } catch {
    console.error('✗ Invalid DATABASE_URL format');
    process.exit(1);
  }

  const pool = new Pool(getPgPoolConfig(process.env.DATABASE_URL));

  try {
    // Test connection first
    await pool.query('SELECT 1');
    console.log('  ✓ Connected to database');

    console.log('🗑️  Dropping application and migration schemas...');

    // Drop schemas (Supabase doesn't allow DROP DATABASE)
    await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
    await pool.query('DROP SCHEMA public CASCADE');
    await pool.query('CREATE SCHEMA public');
    await pool.query('GRANT ALL ON SCHEMA public TO current_user');
    await pool.query('GRANT ALL ON SCHEMA public TO public');

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
