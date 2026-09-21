import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("database pool lock timeout environment", () => {
  it.each([undefined, "", "250"])("accepts optional or positive timeout %s", async (value) => {
    vi.stubEnv("DB_POOL_LOCK_TIMEOUT_MS", value);
    vi.resetModules();
    const { env } = await import("./env");
    expect(env.DB_POOL_LOCK_TIMEOUT_MS).toBe(value ? Number(value) : undefined);
  });

  it.each(["0", "-1", "0.5", "invalid"])("rejects unsafe timeout %s", async (value) => {
    vi.stubEnv("DB_POOL_LOCK_TIMEOUT_MS", value);
    vi.resetModules();
    await expect(import("./env")).rejects.toMatchObject({
      issues: expect.arrayContaining([expect.objectContaining({ path: ["DB_POOL_LOCK_TIMEOUT_MS"] })]),
    });
  });
});
