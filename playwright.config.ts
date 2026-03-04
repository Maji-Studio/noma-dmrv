import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";

// Load test environment variables (only .env.test, never .env.local)
config({ path: ".env.test" });

// Validate that tests only target localhost to prevent accidentally running against staging/production
const baseURL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3100";
try {
  const url = new URL(baseURL);
  if (!["http:", "https:"].includes(url.protocol) || !["localhost", "127.0.0.1"].includes(url.hostname)) {
    throw new Error("invalid");
  }
} catch {
  throw new Error(
    `NEXT_PUBLIC_APP_URL must point to localhost for E2E tests. ` +
      `Got: "${baseURL}". ` +
      `Allowed hostnames: localhost, 127.0.0.1`
  );
}

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",

  // Global timeout - 60s to accommodate Next.js dev-mode page compilation
  timeout: 60000,
  expect: {
    timeout: 10000,
  },

  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    command: "pnpm dev:manual",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120000, // Allow 2 minutes for server startup
  },
});
