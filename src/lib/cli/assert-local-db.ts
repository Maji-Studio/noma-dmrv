import { config } from 'dotenv';
import { describeDatabaseTarget, isLocalDatabaseTarget } from '../pg-pool-config';

// Load environment variables from .env.local
config({ path: '.env.local' });

function assertLocalDatabase(): void {
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

  if (!isLocalDatabaseTarget(process.env.DATABASE_URL) && process.env.DB_MIGRATE_ALLOW_REMOTE !== 'true') {
    console.error(
      '✗ DATABASE_URL does not point at localhost. Refusing to migrate a remote database from the dev script.\n' +
        '  Set DB_MIGRATE_ALLOW_REMOTE=true to override (staging/production migrations must be deliberate).'
    );
    process.exit(1);
  }

  console.log('  ✓ Local database target confirmed');
}

assertLocalDatabase();
