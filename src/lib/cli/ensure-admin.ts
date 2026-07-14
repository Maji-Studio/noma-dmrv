/**
 * CLI entrypoint for the admin + default-organization bootstrap.
 * All logic lives in `ensure-admin-core.ts` so it can be exercised by tests;
 * this file only loads env, runs it, and reports failures without leaking PII.
 */
import { config } from 'dotenv';
import { runEnsureAdmin } from './ensure-admin-core';
// Imported from `../log/sanitize`, not `../log`: the logger barrel imports
// `@/config/env`, which validates the whole app env schema at module load. This
// CLI runs during bootstrap, before that schema is satisfiable (it needs only
// DATABASE_URL + ADMIN_*), so pulling the barrel in would make seeding throw at
// import time in CI and on a fresh deploy.
import { sanitizeErrorMessage } from '../log/sanitize';

config({ path: '.env.local' });

runEnsureAdmin().catch((err: unknown) => {
  // Never pass the raw error: a Drizzle failure embeds bound params (admin
  // email, password hash) in its message. sanitizeErrorMessage strips them.
  console.error(
    JSON.stringify({
      level: 'error',
      op: 'ensure-admin',
      msg: 'Failed to ensure admin',
      errorMessage: sanitizeErrorMessage(err),
    }),
  );
  process.exit(1);
});
