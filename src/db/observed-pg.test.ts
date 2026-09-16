import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { Logger } from "@/lib/log";
import {
  createObservedPool,
  instrumentClient,
  instrumentPoolAcquisition,
  type QueryableClient,
} from "./observed-pg";
import type { Pool, PoolClient, PoolConfig } from "pg";

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

/** Monotonic clock for paths whose internal call order is pg's business. */
function createIncrementingClock(stepMs = 5): () => number {
  let now = 0;
  return () => (now += stepMs);
}

/**
 * Minimal stand-in for a `pg.Client` that satisfies what `pg-pool` calls on the
 * clients it creates, so the pooled path can run without a database.
 */
function createFakeClientClass(
  { connectError }: { connectError?: Error } = {},
): PoolConfig["Client"] {
  class FakePoolClient extends EventEmitter {
    _queryable = true;
    _ending = false;

    connect(callback?: (error?: Error) => void) {
      if (callback) {
        callback(connectError);
        return;
      }
      return connectError ? Promise.reject(connectError) : Promise.resolve();
    }

    query() {
      return Promise.resolve({ rows: [] });
    }

    end(callback?: () => void) {
      callback?.();
      return Promise.resolve();
    }
  }

  return FakePoolClient as unknown as PoolConfig["Client"];
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

  it("reports connection failures but not query failures when telemetry is disabled", async () => {
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

    // A failed query is often ordinary control flow (55P03, unique violations);
    // a connection that cannot be established never is.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      { durationMs: 5, success: false },
      "database connection establishment failed",
    );
  });

  it("reports failures when telemetry is enabled", async () => {
    const { log, warn } = createTestLogger();
    const failure = new Error("connection refused");
    const fakeClient = {
      connect: () => Promise.reject(failure),
      query: () => Promise.reject(failure),
    } as unknown as QueryableClient;

    instrumentClient(fakeClient, {
      enabled: true,
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

  it.each([false, true])(
    "logs failed checkouts whatever the telemetry flag says (enabled %s)",
    async (enabled) => {
      const { info, log, warn } = createTestLogger();
      const failure = new Error("checkout failed");
      const fakePool = {
        connect: () => Promise.reject(failure),
        waitingCount: 1,
        totalCount: 1,
        idleCount: 0,
      } as unknown as Pool;

      instrumentPoolAcquisition(fakePool, {
        enabled,
        clock: createClock(4, 16.5),
        log,
      });

      await expect(fakePool.connect()).rejects.toBe(failure);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(info).not.toHaveBeenCalled();
    },
  );
});

describe("database pool idle-client observability", () => {
  it.each([false, true])(
    "logs idle-client failures whatever the telemetry flag says (enabled %s)",
    async (enabled) => {
      const { log, warn } = createTestLogger();
      const pool = createObservedPool({}, { enabled, log });

      pool.emit("error", new Error("idle connection failed"));

      expect(warn).toHaveBeenCalledTimes(1);
      await pool.end();
    },
  );
});

describe("pooled client instrumentation", () => {
  it("instruments the clients the pool creates and the checkout around them", async () => {
    const { info, log, warn } = createTestLogger();
    const pool = createObservedPool(
      { Client: createFakeClientClass() },
      { enabled: true, clock: createIncrementingClock(), log },
    );

    const client = await pool.connect();
    await client.query("select private_data from records where id = $1", [
      "sensitive-id",
    ]);
    client.release();
    await pool.end();

    const messages = info.mock.calls.map(([, message]) => message);
    expect(messages).toContain("database connection established");
    expect(messages).toContain("database connection acquired");
    expect(messages).toContain("database query finished");
    expect(warn).not.toHaveBeenCalled();
    expect(JSON.stringify(info.mock.calls)).not.toContain("private_data");
    expect(JSON.stringify(info.mock.calls)).not.toContain("sensitive-id");
  });

  it("reports a pooled connection that never establishes, telemetry off", async () => {
    const { info, log, warn } = createTestLogger();
    const failure = new Error("connection refused");
    const pool = createObservedPool(
      { Client: createFakeClientClass({ connectError: failure }) },
      { enabled: false, clock: createIncrementingClock(), log },
    );

    await expect(pool.connect()).rejects.toBe(failure);

    const messages = warn.mock.calls.map(([, message]) => message);
    expect(messages).toContain("database connection establishment failed");
    expect(messages).toContain("database connection acquisition failed");
    expect(info).not.toHaveBeenCalled();
    await pool.end();
  });
});
