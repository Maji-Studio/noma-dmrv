import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/config/env", () => { throw new Error("app config must not load"); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it.each([
  ["production", undefined, false],
  ["development", undefined, true],
  ["production", "  ", false],
  ["development", "debug", true],
  ["development", "silent", false],
] as const)("validates its own level: %s / %s", async (mode, level, debugExpected) => {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", mode);
  vi.stubEnv("LOG_LEVEL", level);
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  const { logger } = await import("./index");
  logger.debug("debug message");
  expect(output).toHaveBeenCalledTimes(debugExpected ? 1 : 0);
  output.mockClear();
  logger.info("info message");
  expect(output).toHaveBeenCalledTimes(level === "silent" ? 0 : 1);
});

it("rejects an invalid level", async () => {
  vi.resetModules();
  vi.stubEnv("LOG_LEVEL", "typo");
  await expect(import("./index")).rejects.toThrow();
});
