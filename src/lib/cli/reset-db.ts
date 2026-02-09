import { Pool } from 'pg';
import { config } from 'dotenv';

// Load environment variables from .env.local
config({ path: '.env.local' });

async function resetDatabase(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error('✗ DATABASE_URL environment variable not set');
    process.exit(1);
  }

  // Parse connection string
  let dbUrl: URL;
  let dbName: string;
  try {
    dbUrl = new URL(process.env.DATABASE_URL);
    dbName = dbUrl.pathname.slice(1);
  } catch {
    console.error('✗ Invalid DATABASE_URL format');
    process.exit(1);
  }

  if (!dbName) {
    console.error('✗ DATABASE_URL must include a database name');
    process.exit(1);
  }

  // Connect to postgres database (not the app database)
  const pool = new Pool({
    host: dbUrl.hostname,
    port: parseInt(dbUrl.port || '5432'),
    database: 'postgres', // Connect to default postgres database
    user: dbUrl.username,
    password: dbUrl.password || undefined,
  });

  try {
    console.log('🗑️  Dropping database...');

    // Terminate all connections to the target database
    await pool.query(`
      SELECT pg_terminate_backend(pg_stat_activity.pid)
      FROM pg_stat_activity
      WHERE pg_stat_activity.datname = $1
        AND pid <> pg_backend_pid();
    `, [dbName]);

    // Escape identifier to prevent SQL injection and handle special characters
    const escapedDbName = `"${dbName.replace(/"/g, '""')}"`;

    // Drop the database
    await pool.query(`DROP DATABASE IF EXISTS ${escapedDbName}`);
    console.log(`  ✓ Dropped database: ${dbName}`);

    // Recreate the database
    await pool.query(`CREATE DATABASE ${escapedDbName}`);
    console.log(`  ✓ Created database: ${dbName}\n`);

    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Reset failed:', error);
    await pool.end();
    process.exit(1);
  }
}

resetDatabase();
