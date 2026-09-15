import { describe, expect, it, vi } from "vitest";
import type { Logger } from "@/lib/log";
import {
  instrumentClient,
  instrumentPoolAcquisition,
  type QueryableClient,
} from "./observed-pg";
import type { Pool, PoolClient } from "pg";

function createTestLogger() {
  const info = vi.fn();
  const warn = vi.fn();
  function child(): Logger {
    return log;
  }
  const log: Logger = {
    trace: vi.fn() as Logger["trace"],
    debug: vi.fn() as Logger["debug"],
    info: info as Logger["info"],
    warn: warn as Logger["warn"],
    error: vi.fn() as Logger["error"],
    fatal: vi.fn() as Logger["fatal"],
    child,
  };
  return { info, log, warn };
}

function createClock(...values: number[]): () => number {
  let index = 0;
  return () => values[index++] ?? values.at(-1) ?? 0;
}

describe("database client observability", () => {
  it("records establishment and query execution without SQL or parameters", async () => {
    const { info, log } = createTestLogger();
    const fakeClient = {
      connect: () => Promise.resolve(),
      query: () => Promise.resolve({ rows: [] }),
    } as unknown as QueryableClient;

    instrumentClient(fakeClient, {
      enabled: true,
      clock: createClock(10, 14.2, 20, 27.8),
      log,
    });

    await fakeClient.connect();
    await fakeClient.query("select private_data from records where id = $1", [
      "sensitive-id",
    ]);

    expect(info).toHaveBeenNthCalledWith(
      1,
      { durationMs: 4.2, success: true },
      "database connection established",
    );
    expect(info).toHaveBeenNthCalledWith(
      2,
      { durationMs: 7.8, success: true },
      "database query finished",
    );
    expect(JSON.stringify(info.mock.calls)).not.toContain("private_data");
    expect(JSON.stringify(info.mock.calls)).not.toContain("sensitive-id");
  });

  it("reports failures even when detailed telemetry is disabled", async () => {
    const { log, warn } = createTestLogger();
    const failure = new Error("connection refused");
    const fakeClient = {
      connect: () => Promise.reject(failure),
      query: () => Promise.reject(failure),
    } as unknown as QueryableClient;

    instrumentClient(fakeClient, {
      enabled: false,
      clock: createClock(0, 5, 10, 18),
      log,
    });

    await expect(fakeClient.connect()).rejects.toBe(failure);
    await expect(fakeClient.query("select 1")).rejects.toBe(failure);

    expect(warn).toHaveBeenNthCalledWith(
      1,
      { durationMs: 5, success: false },
      "database connection establishment failed",
    );
    expect(warn).toHaveBeenNthCalledWith(
      2,
      { durationMs: 8, success: false },
      "database query failed",
    );
  });
});

describe("database pool acquisition observability", () => {
  it("records checkout duration and queue pressure", async () => {
    const { info, log } = createTestLogger();
    const client = {} as PoolClient;
    const fakePool = {
      connect: () => Promise.resolve(client),
      waitingCount: 2,
      totalCount: 5,
      idleCount: 0,
    } as unknown as Pool;

    instrumentPoolAcquisition(fakePool, {
      enabled: true,
      clock: createClock(4, 16.5),
      log,
    });

    await expect(fakePool.connect()).resolves.toBe(client);
    expect(info).toHaveBeenCalledWith(
      {
        durationMs: 12.5,
        success: true,
        waitingBefore: 2,
        waitingAfter: 2,
        totalConnections: 5,
        idleConnections: 0,
      },
      "database connection acquired",
    );
  });
});
