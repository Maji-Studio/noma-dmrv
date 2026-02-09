import { Pool } from 'pg';
import { config } from 'dotenv';

const MAX_RETRIES = 30;
const RETRY_INTERVAL = 1000; // 1 second

// Load environment variables from .env.local
config({ path: '.env.local' });

async function waitForDatabase(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error('✗ DATABASE_URL environment variable not set');
    process.exit(1);
  }

  // Use discrete config fields to avoid password parsing issues with reserved characters in connection URLs
  let url: URL;
  try {
    url = new URL(process.env.DATABASE_URL);
  } catch {
    console.error('✗ DATABASE_URL is not a valid URL');
    process.exit(1);
  }

  const pool = new Pool({
    host: url.hostname,
    port: parseInt(url.port || '5432'),
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password || undefined,
  });

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await pool.query('SELECT 1');
      console.log('✓ Database is ready');
      await pool.end();
      process.exit(0);
      return;
    } catch (error) {
      console.log(`Waiting for database... (${attempt}/${MAX_RETRIES})`);

      if (attempt === MAX_RETRIES) {
        console.error('✗ Database connection failed after maximum retries');
        console.error(error);
        await pool.end();
        process.exit(1);
        return;
      }

      await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL));
    }
  }
}

waitForDatabase();
