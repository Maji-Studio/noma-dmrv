import { Pool } from 'pg';
import { config } from 'dotenv';

// Load environment variables from .env.local
config({ path: '.env.local' });

async function resetDatabase(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error('✗ DATABASE_URL environment variable not set');
    process.exit(1);
  }

  // Debug: log connection target (no credentials)
  try {
    const url = new URL(process.env.DATABASE_URL);
    console.log(`Connection target: host=${url.hostname} port=${url.port || '5432'} user=${url.username} db=${url.pathname.slice(1)} sslmode=${url.searchParams.get('sslmode') ?? 'not set'}`);
  } catch {
    console.error('✗ Invalid DATABASE_URL format');
    process.exit(1);
  }

  // Use connectionString so pg parses sslmode and all params correctly
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

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
