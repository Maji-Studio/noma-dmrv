import { expect, it, vi } from "vitest";

it("imports transcript without loading application environment config", async () => {
  vi.resetModules();
  vi.doMock("@/config/env", () => {
    throw new Error("env loaded before dotenv");
  });

  try {
    await expect(import("./transcript")).resolves.toHaveProperty("parseTranscript");
  } finally {
    vi.doUnmock("@/config/env");
    vi.resetModules();
  }
});
