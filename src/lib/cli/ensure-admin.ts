/**
 * CLI entrypoint for the admin + default-organization bootstrap.
 * All logic lives in `ensure-admin-core.ts` so it can be exercised by tests;
 * this file only loads env, runs it, and reports failures without leaking PII.
 */
import { config } from 'dotenv';
import { runEnsureAdmin } from './ensure-admin-core';
import { logger, sanitizeErrorMessage } from '../log';

config({ path: '.env.local' });

runEnsureAdmin().catch((err: unknown) => {
  // Never pass the raw error: a Drizzle failure embeds bound params (admin
  // email, password hash) in its message. sanitizeErrorMessage strips them.
  logger.error(
    { op: 'ensure-admin', errorMessage: sanitizeErrorMessage(err) },
    'Failed to ensure admin',
  );
  process.exit(1);
});
