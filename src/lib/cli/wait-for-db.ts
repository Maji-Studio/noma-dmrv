import { Pool } from 'pg';
import { config } from 'dotenv';
import { getPgPoolConfig } from '../pg-pool-config';

const MAX_RETRIES = 30;
const RETRY_INTERVAL = 1000; // 1 second

// Load environment variables from .env.local
config({ path: '.env.local' });

async function waitForDatabase(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error('✗ DATABASE_URL environment variable not set');
    process.exit(1);
  }

  let pool: Pool;
  try {
    pool = new Pool(getPgPoolConfig(process.env.DATABASE_URL));
  } catch {
    console.error('✗ DATABASE_URL is not a valid URL');
    process.exit(1);
  }

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
