import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  const base = {
    DATABASE_URL: "postgresql://localhost/unused", NEXT_PUBLIC_APP_URL: "http://localhost:3100",
    BETTER_AUTH_SECRET: randomBytes(32).toString("hex"), NODE_ENV: "test",
    RESEND_API_KEY: "", RESEND_FROM_EMAIL: "", ISOMETRIC_CLIENT_SECRET: "", ISOMETRIC_ACCESS_TOKEN: "",
    STORAGE_PROVIDER: "local-fs", CRON_SECRET: "", API_WRITES_DISABLED: "false",
    CREDENTIALS_ENCRYPTION_KEY: "", NOMA_HERMETIC_CI: "", CI: "", GEO_PROVIDER: "ors",
  };
  for (const [key, value] of Object.entries(base)) vi.stubEnv(key, value);
});
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

it("permits an absent cron secret outside production and defaults writes to enabled", async () => {
  vi.stubEnv("API_WRITES_DISABLED", undefined);
  const { env } = await import("./env");
  expect(env.CRON_SECRET).toBeUndefined();
  expect(env.API_WRITES_DISABLED).toBe(false);
});
it("requires a cron secret on real production deployments", async () => {
  vi.stubEnv("NODE_ENV", "production");
  await expect(import("./env")).rejects.toMatchObject({ issues: expect.arrayContaining([expect.objectContaining({ path: ["CRON_SECRET"] })]) });
});
it("preserves the explicit hermetic-CI exception", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NOMA_HERMETIC_CI", "true");
  vi.stubEnv("CI", "true");
  expect((await import("./env")).env.CRON_SECRET).toBeUndefined();
});
it("rejects short secrets and accepts generated secrets", async () => {
  vi.stubEnv("CRON_SECRET", randomBytes(8).toString("hex"));
  await expect(import("./env")).rejects.toMatchObject({ issues: expect.arrayContaining([expect.objectContaining({ path: ["CRON_SECRET"] })]) });
  vi.resetModules();
  vi.stubEnv("CRON_SECRET", randomBytes(32).toString("hex"));
  expect((await import("./env")).env.CRON_SECRET).toBeTruthy();
});
it("decodes the write switch and rejects misspellings", async () => {
  vi.stubEnv("API_WRITES_DISABLED", "true");
  expect((await import("./env")).env.API_WRITES_DISABLED).toBe(true);
  vi.resetModules();
  vi.stubEnv("API_WRITES_DISABLED", "treu");
  await expect(import("./env")).rejects.toMatchObject({ issues: expect.arrayContaining([expect.objectContaining({ path: ["API_WRITES_DISABLED"] })]) });
});
