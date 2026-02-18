import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";

// Load test environment variables
config({ path: ".env.test" });
config({ path: ".env.local" });

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",

  // Global timeout settings
  timeout: 30000,
  expect: {
    timeout: 10000,
  },

  use: {
    baseURL: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3100",
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
    url: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 120000, // Allow 2 minutes for server startup
  },
});
