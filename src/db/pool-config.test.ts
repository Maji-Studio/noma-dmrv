import { describe, expect, it } from "vitest";
import {
  DEFAULT_DB_POOL_CONNECTION_TIMEOUT_MS,
  DEFAULT_DB_POOL_IDLE_TIMEOUT_MS,
  DEFAULT_DB_POOL_LOCK_TIMEOUT_MS,
  DEFAULT_DB_POOL_MAX,
  resolveAppPoolConfig,
} from "./pool-config";

const connection = {
  connectionString: "postgresql://user:password@database.example/app",
  ssl: true,
};

describe("resolveAppPoolConfig", () => {
  it("keeps a conservative size until deployment capacity is known", () => {
    expect(
      resolveAppPoolConfig({ connection, isVercel: true }),
    ).toMatchObject({
      ...connection,
      max: DEFAULT_DB_POOL_MAX,
      idleTimeoutMillis: DEFAULT_DB_POOL_IDLE_TIMEOUT_MS,
      connectionTimeoutMillis: DEFAULT_DB_POOL_CONNECTION_TIMEOUT_MS,
      lock_timeout: DEFAULT_DB_POOL_LOCK_TIMEOUT_MS,
    });
  });

  it.each([1, 3, 5])("accepts the planned Vercel candidate %i", (configuredMax) => {
    expect(
      resolveAppPoolConfig({ connection, configuredMax, isVercel: true }).max,
    ).toBe(configuredMax);
  });

  it("rejects a Vercel pool larger than the bounded candidate ceiling", () => {
    expect(() =>
      resolveAppPoolConfig({
        connection,
        configuredMax: 6,
        isVercel: true,
      }),
    ).toThrow("DB_POOL_MAX cannot exceed 5 on Vercel");
  });

  it("does not impose the serverless ceiling on a long-running deployment", () => {
    expect(
      resolveAppPoolConfig({
        connection,
        configuredMax: 10,
        isVercel: false,
      }).max,
    ).toBe(10);
  });

  it("preserves explicit timeout and lock settings", () => {
    expect(
      resolveAppPoolConfig({
        connection,
        configuredIdleTimeoutMs: 7_000,
        configuredConnectionTimeoutMs: 8_000,
        configuredLockTimeoutMs: 900,
        isVercel: false,
      }),
    ).toMatchObject({
      idleTimeoutMillis: 7_000,
      connectionTimeoutMillis: 8_000,
      lock_timeout: 900,
    });
  });
});
