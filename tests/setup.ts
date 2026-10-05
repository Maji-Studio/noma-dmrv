/**
 * Vitest setup file
 * Runs before all tests
 */
import { config } from "dotenv";
import {
  assertThrowawayTestDatabase,
  resolveTestDatabaseUrl,
} from "./helpers/throwaway-database";

// Load environment variables for testing
config({ path: ".env.test" });

// E2E fixtures (tests/e2e/fixtures/seed-chain-data.ts and others) import this
// file too, inside Playwright. They must keep the dev server's DATABASE_URL and
// origin, so the Vitest-only rules below apply under Vitest alone.
const underVitest = Boolean(process.env.VITEST);

// TEST_DATABASE_URL lets .env.test give Vitest its own database while
// Playwright keeps DATABASE_URL (the dev server's) from the same file.
if (underVitest) {
  const testDatabaseUrl = resolveTestDatabaseUrl(process.env);
  if (testDatabaseUrl) process.env.DATABASE_URL = testDatabaseUrl;
}

const testEnvDefaults: Record<string, string> = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/app_template_test",
  // The app default is a single connection, but the DB-backed concurrency
  // tests (tests/certification-submissions.test.ts) hold a transaction open
  // while a second claim and a third mutation each need their own
  // connection — a pool of 1 starves them into connect timeouts.
  DB_POOL_MAX: "10",
  NEXT_PUBLIC_APP_URL: "http://localhost:3100",
  BETTER_AUTH_SECRET: "test-secret-32-chars-minimum-length",
  RESEND_API_KEY: "",
  RESEND_FROM_EMAIL: "",
  ALLOW_SELF_SIGNUP: "false",
  ADMIN_EMAIL: "admin@example.com",
  CREDENTIALS_ENCRYPTION_KEY: "00".repeat(32),
  STORAGE_PROVIDER: "local-fs",
  STORAGE_SIGNING_SECRET: "test-signing-secret-32-chars-minimum-length",
  STORAGE_LOCAL_FS_ROOT: ".storage-test",
};

for (const [key, value] of Object.entries(testEnvDefaults)) {
  if (!process.env[key]) {
    process.env[key] = value;
  }
}

if (underVitest) {
  // Vitest never talks to a running server, and specs hard-code :3100 report
  // URLs checked against this origin; a worktree's .env.test moves it to the
  // worktree's dev port for Playwright.
  process.env.NEXT_PUBLIC_APP_URL = testEnvDefaults.NEXT_PUBLIC_APP_URL;
  // Last, so it judges the URL every suite will actually connect to.
  assertThrowawayTestDatabase(process.env.DATABASE_URL!);
}
