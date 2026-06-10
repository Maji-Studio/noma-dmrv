/**
 * Vitest setup file
 * Runs before all tests
 */
import { config } from "dotenv";

// Load environment variables for testing
config({ path: ".env.test" });

const testEnvDefaults: Record<string, string> = {
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
  STORAGE_PROVIDER: "local-fs",
  STORAGE_SIGNING_SECRET: "test-signing-secret-32-chars-minimum-length",
  STORAGE_LOCAL_FS_ROOT: ".storage-test",
};

for (const [key, value] of Object.entries(testEnvDefaults)) {
  if (!process.env[key]) {
    process.env[key] = value;
  }
}
