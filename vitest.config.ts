import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    restoreMocks: true,
    exclude: [
      "**/node_modules/**",
      "**/e2e/**",
      // Git worktrees live under `.claude/worktrees/` and carry a full copy of
      // `tests/`. Without this the parent repo collects and runs another
      // branch's suites — against this repo's database, so the two contend and
      // fail each other. Each worktree runs its own vitest.
      "**/.claude/worktrees/**",
    ],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
});
