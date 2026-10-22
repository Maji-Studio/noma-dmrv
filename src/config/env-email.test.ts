import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const EMAIL_CONFIG = {
  RESEND_API_KEY: "synthetic",
  RESEND_FROM_EMAIL: "sender@example.test",
  RESEND_REPLY_TO: "support@example.test",
};

beforeEach(() => {
  vi.resetModules();
  for (const [key, value] of Object.entries({
    DATABASE_URL: "postgresql://localhost/unused", NEXT_PUBLIC_APP_URL: "https://app.example.test",
    BETTER_AUTH_SECRET: randomBytes(32).toString("hex"), NODE_ENV: "production",
    ...EMAIL_CONFIG, ISOMETRIC_CLIENT_SECRET: "", ISOMETRIC_ACCESS_TOKEN: "",
    CREDENTIALS_ENCRYPTION_KEY: randomBytes(32).toString("hex"), ISOMETRIC_ENVIRONMENT: "production",
    CRON_SECRET: randomBytes(32).toString("hex"), GEO_PROVIDER: "ors",
    STORAGE_PROVIDER: "s3-compatible", STORAGE_BUCKET: "synthetic", STORAGE_REGION: "eu-central-1",
    STORAGE_ACCESS_KEY_ID: "synthetic", STORAGE_SECRET_ACCESS_KEY: "synthetic", STORAGE_ENDPOINT: "",
    NOMA_HERMETIC_CI: "", CI: "", API_FUZZ_DISABLE_RATE_LIMIT: "false",
    OAUTH_PROVIDER_ENABLED: "false", OAUTH_CIMD_CLIENT_IDS: "",
  })) vi.stubEnv(key, value);
});
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

it("boots production with all three email settings", async () => {
  expect((await import("./env")).env).toMatchObject(EMAIL_CONFIG);
});

it.each(Object.keys(EMAIL_CONFIG))("refuses production without %s and names it", async (key) => {
  vi.stubEnv(key, "");
  await expect(import("./env")).rejects.toMatchObject({ issues: expect.arrayContaining([
    expect.objectContaining({ message: `Production email delivery requires: ${key}` }),
  ]) });
});

it("names all missing email settings in one production error", async () => {
  for (const key of Object.keys(EMAIL_CONFIG)) vi.stubEnv(key, undefined);
  await expect(import("./env")).rejects.toMatchObject({ issues: [expect.objectContaining({
    message: "Production email delivery requires: RESEND_API_KEY, RESEND_FROM_EMAIL, RESEND_REPLY_TO",
  })] });
});

it.each(["development", "test", "hermetic-ci"])("allows no email settings for %s", async (mode) => {
  for (const key of Object.keys(EMAIL_CONFIG)) vi.stubEnv(key, "");
  vi.stubEnv("NODE_ENV", mode === "hermetic-ci" ? "production" : mode);
  if (mode === "hermetic-ci") {
    vi.stubEnv("CI", "true");
    vi.stubEnv("NOMA_HERMETIC_CI", "true");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3100");
  }
  expect((await import("./env")).env.RESEND_API_KEY).toBeUndefined();
});

it.each([
  { CI: "true", NOMA_HERMETIC_CI: "", NEXT_PUBLIC_APP_URL: "http://localhost:3100" },
  { CI: "", NOMA_HERMETIC_CI: "true", NEXT_PUBLIC_APP_URL: "http://localhost:3100" },
  { CI: "true", NOMA_HERMETIC_CI: "true", NEXT_PUBLIC_APP_URL: "https://app.example.test" },
])("does not exempt non-hermetic production: %j", async (overrides) => {
  for (const [key, value] of Object.entries(overrides)) vi.stubEnv(key, value);
  vi.stubEnv("RESEND_REPLY_TO", "");
  await expect(import("./env")).rejects.toMatchObject({ issues: expect.arrayContaining([
    expect.objectContaining({ message: "Production email delivery requires: RESEND_REPLY_TO" }),
  ]) });
});

it.each(["RESEND_API_KEY", "RESEND_FROM_EMAIL"])("keeps both-or-neither outside production without %s", async (key) => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv(key, "");
  await expect(import("./env")).rejects.toMatchObject({ issues: expect.arrayContaining([
    expect.objectContaining({ message: "RESEND_API_KEY and RESEND_FROM_EMAIL must either both be set or both be omitted" }),
  ]) });
});

it("validates reply-to as an email even outside production", async () => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("RESEND_REPLY_TO", "invalid");
  await expect(import("./env")).rejects.toMatchObject({ issues: expect.arrayContaining([
    expect.objectContaining({ path: ["RESEND_REPLY_TO"] }),
  ]) });
});
