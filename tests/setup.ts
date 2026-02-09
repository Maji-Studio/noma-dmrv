/**
 * Vitest setup file
 * Runs before all tests
 */
import { config } from "dotenv";

// Load environment variables for testing
config({ path: ".env.test" });

const testEnvDefaults: Record<string, string> = {
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/app_template_test",
  NEXT_PUBLIC_APP_URL: "http://localhost:3100",
  BETTER_AUTH_SECRET: "test-secret-32-chars-minimum-length",
  RESEND_API_KEY: "",
  RESEND_FROM_EMAIL: "",
  ALLOW_SELF_SIGNUP: "false",
  ADMIN_EMAIL: "admin@example.com",
};

for (const [key, value] of Object.entries(testEnvDefaults)) {
  if (!process.env[key]) {
    process.env[key] = value;
  }
}
