import {
  Client,
  Pool,
  type ClientConfig,
  type PoolClient,
  type PoolConfig,
} from "pg";
import { sanitizeErrorMessage, type Logger } from "@/lib/log";

/** Non-PII identity of a driver fault: SQLSTATE/errno plus the scrubbed message. */
function faultFields(error: unknown) {
  return {
    code: (error as { code?: string } | null)?.code,
    reason: sanitizeErrorMessage(error),
  };
}

// Durations are reported to one decimal place; sub-0.1 ms noise is not useful.
const DURATION_PRECISION_FACTOR = 10;
const DB_POOL_LOG_BINDINGS = { mod: "db-pool" };

type Clock = () => number;

interface ObservabilityOptions {
  clock?: Clock;
  /**
   * Injected by `src/db/index.ts`. The pool never reaches for the ambient
   * logger itself, so only the pool entry point touches `@/lib/log`.
   */
  log: Logger;
}

export interface QueryableClient {
  connect: Client["connect"];
  query: Client["query"];
}

const OBSERVED_CLIENT = Symbol("noma-observed-pg-client");
type ObservedClient = QueryableClient & { [OBSERVED_CLIENT]?: true };

function roundDuration(durationMs: number): number {
  return (
    Math.round(durationMs * DURATION_PRECISION_FACTOR) /
    DURATION_PRECISION_FACTOR
  );
}

export function instrumentClient(
  client: QueryableClient,
  { clock = performance.now.bind(performance), log }: ObservabilityOptions,
): void {
  const observedClient = client as ObservedClient;
  if (observedClient[OBSERVED_CLIENT]) return;
  observedClient[OBSERVED_CLIENT] = true;

  const dbLog = log.child(DB_POOL_LOG_BINDINGS);
  const originalConnect = client.connect.bind(client);
  client.connect = ((callback?: (error?: Error) => void) => {
    const startedAt = clock();
    const finish = (success: boolean, error?: unknown) => {
      const fields = {
        durationMs: roundDuration(clock() - startedAt),
        success,
      };
      if (success) dbLog.trace(fields, "database connection established");
      else
        dbLog.warn(
          { ...fields, ...faultFields(error) },
          "database connection establishment failed",
        );
    };

    if (callback) {
      return originalConnect((error?: Error) => {
        finish(!error, error);
        callback(error);
      });
    }

    return originalConnect().then(
      () => finish(true),
      (error: unknown) => {
        finish(false, error);
        throw error;
      },
    );
  }) as Client["connect"];

  const originalQuery = client.query.bind(client);
  client.query = ((...queryArgs: unknown[]) => {
    const startedAt = clock();
    let finished = false;
    const finish = (success: boolean) => {
      if (finished) return;
      finished = true;
      const fields = {
        durationMs: roundDuration(clock() - startedAt),
        success,
      };
      // Both outcomes at trace: a failed query is often ordinary control flow
      // here (`55P03` lock timeouts, unique-violation retries), unlike the
      // infrastructure faults below, which always warn.
      if (success) dbLog.trace(fields, "database query finished");
      else dbLog.trace(fields, "database query failed");
    };

    const lastIndex = queryArgs.length - 1;
    const possibleCallback = queryArgs[lastIndex];
    if (typeof possibleCallback === "function") {
      queryArgs[lastIndex] = (...callbackArgs: unknown[]) => {
        finish(callbackArgs[0] == null);
        return Reflect.apply(possibleCallback, undefined, callbackArgs);
      };
    }

    try {
      const query = originalQuery as unknown as (
        ...args: unknown[]
      ) => unknown;
      const result = query(...queryArgs);

      if (typeof possibleCallback === "function") return result;
      if (result && typeof result === "object" && "then" in result) {
        return Promise.resolve(result).then(
          (value) => {
            finish(true);
            return value;
          },
          (error: unknown) => {
            finish(false);
            throw error;
          },
        );
      }
      if (result && typeof result === "object" && "once" in result) {
        const evented = result as {
          once(event: "end" | "error", listener: () => void): unknown;
        };
        evented.once("end", () => finish(true));
        evented.once("error", () => finish(false));
      }
      return result;
    } catch (error) {
      finish(false);
      throw error;
    }
  }) as Client["query"];
}

export function instrumentPoolAcquisition(
  pool: Pool,
  { clock = performance.now.bind(performance), log }: ObservabilityOptions,
): void {
  const dbLog = log.child(DB_POOL_LOG_BINDINGS);
  const originalConnect = pool.connect.bind(pool);

  pool.connect = ((
    callback?: (
      error: Error | undefined,
      client: PoolClient | undefined,
      done: (release?: unknown) => void,
    ) => void,
  ) => {
    const startedAt = clock();
    const waitingBefore = pool.waitingCount;
    const finish = (success: boolean, error?: unknown) => {
      const fields = {
        durationMs: roundDuration(clock() - startedAt),
        success,
        waitingBefore,
        waitingAfter: pool.waitingCount,
        totalConnections: pool.totalCount,
        idleConnections: pool.idleCount,
      };
      if (success) dbLog.trace(fields, "database connection acquired");
      else
        dbLog.warn(
          { ...fields, ...faultFields(error) },
          "database connection acquisition failed",
        );
    };

    if (callback) {
      return originalConnect((error, client, done) => {
        finish(!error, error);
        callback(error, client, done);
      });
    }

    return originalConnect().then(
      (client) => {
        finish(true);
        return client;
      },
      (error: unknown) => {
        finish(false, error);
        throw error;
      },
    );
  }) as Pool["connect"];
}

export function createObservedPool(
  config: PoolConfig,
  options: ObservabilityOptions,
): Pool {
  // Honour a caller-supplied client class (pg's own `PoolConfig.Client`) so
  // the pooled path can be driven without a database.
  const BaseClient = (config.Client ?? Client) as unknown as typeof Client;

  class InstrumentedClient extends BaseClient {
    constructor(clientConfig?: string | ClientConfig) {
      super(clientConfig);
      instrumentClient(this, options);
    }
  }

  const pool = new Pool({ ...config, Client: InstrumentedClient });
  instrumentPoolAcquisition(pool, options);
  // Always logged, and always listened for: an unhandled `error` event on an
  // idle client would otherwise take the process down.
  pool.on("error", (error: unknown) => {
    options.log
      .child(DB_POOL_LOG_BINDINGS)
      .warn(faultFields(error), "idle database connection failed");
  });
  return pool;
}

export function createObservedClient(
  config: ClientConfig,
  options: ObservabilityOptions,
): Client {
  const client = new Client(config);
  instrumentClient(client, options);
  return client;
}
