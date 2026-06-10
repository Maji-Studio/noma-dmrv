import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";

// Load test environment variables (only .env.test, never .env.local)
config({ path: ".env.test" });

// Validate that tests only target localhost to prevent accidentally running against staging/production
const baseURL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3100";
const DEFAULT_CI_WORKERS = 2;
const DEFAULT_CI_RETRIES = 1;
const ciWorkers = positiveIntegerFromEnv("PLAYWRIGHT_WORKERS", DEFAULT_CI_WORKERS);
const ciRetries = positiveIntegerFromEnv("PLAYWRIGHT_RETRIES", DEFAULT_CI_RETRIES);

function positiveIntegerFromEnv(name: string, fallback: number) {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

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
  globalTeardown: "./tests/e2e/global-teardown.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? ciRetries : 0,
  workers: process.env.CI ? ciWorkers : undefined,
  reporter: "html",

  // Global per-test timeout. CI uses a production build (fast page loads), local uses dev mode (Turbopack compilation can be slow on first hit).
  timeout: process.env.CI ? 60000 : 90000,
  expect: {
    timeout: 15000,
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

  // On CI we build once and start the production server — dev-mode compilation
  // was timing out tests waiting for first page render. Locally we keep the dev
  // server for fast iteration and `reuseExistingServer`.
  webServer: {
    command: process.env.CI ? "pnpm build && pnpm start -p 3100" : "pnpm dev:manual",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: process.env.CI ? 300000 : 120000, // 5 min for CI build, 2 min local
  },
});
