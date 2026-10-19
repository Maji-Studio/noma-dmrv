import { defineConfig } from "vitest/config";
import { resolve } from "path";

const DEFAULT_LOCAL_MAX_WORKERS = 2;
const configuredMaxWorkers = Number(process.env.VITEST_MAX_WORKERS ?? DEFAULT_LOCAL_MAX_WORKERS);
const localMaxWorkers = Number.isInteger(configuredMaxWorkers) && configuredMaxWorkers > 0
  ? configuredMaxWorkers
  : DEFAULT_LOCAL_MAX_WORKERS;

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    globalSetup: ["./tests/global-setup.ts"],
    maxWorkers: process.env.CI ? undefined : localMaxWorkers,
    restoreMocks: true,
    exclude: [
      "**/node_modules/**",
      "**/e2e/**",
      // Opt-in Playwright capture specs (playwright.visual.config.ts).
      "**/tests/visual/**",
      // Git worktrees live under `.claude/worktrees/` and carry a full copy of
      // `tests/`. Without this the parent repo collects and runs another
      // branch's suites — against this repo's database, so the two contend and
      // fail each other. Each worktree runs its own vitest.
      "**/.claude/worktrees/**",
      // The landing site is a separate package (site/).
      "site/**",
    ],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
});
