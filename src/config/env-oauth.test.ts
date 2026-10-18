import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  for (const [key, value] of Object.entries({
    DATABASE_URL: "postgresql://localhost/unused", NEXT_PUBLIC_APP_URL: "http://localhost:3100",
    BETTER_AUTH_SECRET: randomBytes(32).toString("hex"), NODE_ENV: "test",
    RESEND_API_KEY: "", RESEND_FROM_EMAIL: "", ISOMETRIC_CLIENT_SECRET: "", ISOMETRIC_ACCESS_TOKEN: "",
    STORAGE_PROVIDER: "local-fs", GEO_PROVIDER: "ors", API_FUZZ_DISABLE_RATE_LIMIT: "false", NOMA_HERMETIC_CI: "", CI: "",
    OAUTH_CIMD_CLIENT_IDS: "", OAUTH_PROVIDER_ENABLED: "false",
  })) vi.stubEnv(key, value);
});
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
it("defaults to disabled with no CIMD identities", async () => {
  vi.stubEnv("OAUTH_PROVIDER_ENABLED", undefined);
  vi.stubEnv("OAUTH_CIMD_CLIENT_IDS", undefined);
  const { env } = await import("./env");
  expect(env.OAUTH_PROVIDER_ENABLED).toBe(false);
  expect(env.OAUTH_CIMD_CLIENT_IDS).toEqual([]);
});
it("preserves exact identities", async () => {
  vi.stubEnv("OAUTH_CIMD_CLIENT_IDS", "https://claude.ai/oauth/mcp-oauth-client-metadata, https://chatgpt.com/client");
  expect((await import("./env")).env.OAUTH_CIMD_CLIENT_IDS).toEqual(["https://claude.ai/oauth/mcp-oauth-client-metadata", "https://chatgpt.com/client"]);
});
it.each(["http://claude.ai/client", "https://localhost/client", "https://127.0.0.1/client", "https://[::1]/client", "https://foo.local/client", "https://foo.test/client", "https://claude.ai", "https://claude.ai:443/client", "https://claude.ai/client?q=x", "https://claude.ai/client#x", "https://user@claude.ai/client", "https://claude.ai/client,"])("rejects invalid client identity %s", async value => {
  vi.stubEnv("OAUTH_CIMD_CLIENT_IDS", value);
  await expect(import("./env")).rejects.toMatchObject({ issues: expect.arrayContaining([expect.objectContaining({ path: ["OAUTH_CIMD_CLIENT_IDS"] })]) });
});
it.each(["http://app.noma.maji.studio", "https://app.noma.maji.studio/", "https://app.noma.maji.studio/path", "https://app.noma.maji.studio?q=x"])("rejects production OAuth origin %s", async value => {
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("OAUTH_PROVIDER_ENABLED", "true"); vi.stubEnv("NEXT_PUBLIC_APP_URL", value);
  await expect(import("./env")).rejects.toMatchObject({ issues: expect.arrayContaining([expect.objectContaining({ path: ["NEXT_PUBLIC_APP_URL"] })]) });
});
it("permits loopback only under the hermetic production exception", async () => {
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("OAUTH_PROVIDER_ENABLED", "true");
  vi.stubEnv("CI", "true"); vi.stubEnv("NOMA_HERMETIC_CI", "true");
  expect((await import("./env")).env.OAUTH_PROVIDER_ENABLED).toBe(true);
});
it("rejects a misspelled flag", async () => {
  vi.stubEnv("OAUTH_PROVIDER_ENABLED", "yes");
  await expect(import("./env")).rejects.toThrow();
});
it("accepts an enabled production HTTPS origin with the other production gates satisfied", async () => {
  for (const [key, value] of Object.entries({
    NODE_ENV: "production", OAUTH_PROVIDER_ENABLED: "true", NEXT_PUBLIC_APP_URL: "https://app.noma.maji.studio",
    CRON_SECRET: randomBytes(32).toString("hex"), CREDENTIALS_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    ISOMETRIC_ENVIRONMENT: "production", STORAGE_PROVIDER: "s3-compatible", STORAGE_BUCKET: "synthetic",
    STORAGE_REGION: "eu-central-1", STORAGE_ACCESS_KEY_ID: "synthetic", STORAGE_SECRET_ACCESS_KEY: "synthetic",
  })) vi.stubEnv(key, value);
  expect((await import("./env")).env.OAUTH_PROVIDER_ENABLED).toBe(true);
});
