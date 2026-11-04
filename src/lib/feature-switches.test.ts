import { afterEach, expect, it, vi } from "vitest";
import { SafeError } from "@/lib/errors";
import {
  mcpEnabled, stockAdjustmentsEnabled, multiBinRunsEnabled,
  requireStockAdjustmentsEnabled, requireMultiBinRunsEnabled,
} from "./feature-switches";

afterEach(() => vi.unstubAllEnvs());

it.each([
  ["MCP_ENABLED", mcpEnabled],
  ["STOCK_ADJUSTMENTS_ENABLED", stockAdjustmentsEnabled],
  ["MULTI_BIN_RUNS_ENABLED", multiBinRunsEnabled],
] as const)("parses %s on every call and defaults off", (name, enabled) => {
  vi.stubEnv(name, undefined);
  expect(enabled()).toBe(false);
  vi.stubEnv(name, "true");
  expect(enabled()).toBe(true);
  vi.stubEnv(name, "false");
  expect(enabled()).toBe(false);
  vi.stubEnv(name, "yes");
  expect(enabled).toThrow();
});

it("throws safe write refusals only while disabled", () => {
  vi.stubEnv("STOCK_ADJUSTMENTS_ENABLED", "false");
  vi.stubEnv("MULTI_BIN_RUNS_ENABLED", "false");
  expect(requireStockAdjustmentsEnabled).toThrow(SafeError);
  expect(requireMultiBinRunsEnabled).toThrow(SafeError);
  vi.stubEnv("STOCK_ADJUSTMENTS_ENABLED", "true");
  vi.stubEnv("MULTI_BIN_RUNS_ENABLED", "true");
  expect(requireStockAdjustmentsEnabled).not.toThrow();
  expect(requireMultiBinRunsEnabled).not.toThrow();
});
