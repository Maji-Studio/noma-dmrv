import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: { alias: { "@": resolve(process.cwd(), "src") } },
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["docs/archive/qa/2026-09-08-lifecycle-audit/*-simulation.ts"],
    fileParallelism: false,
  },
});
