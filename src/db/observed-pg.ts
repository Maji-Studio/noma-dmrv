import {
  Client,
  Pool,
  type ClientConfig,
  type PoolClient,
  type PoolConfig,
} from "pg";
import { logger, type Logger } from "@/lib/log";

type Clock = () => number;

interface ObservabilityOptions {
  enabled: boolean;
  clock?: Clock;
  log?: Logger;
}

export interface QueryableClient {
  connect: Client["connect"];
  query: Client["query"];
}

const OBSERVED_CLIENT = Symbol("noma-observed-pg-client");
type ObservedClient = QueryableClient & { [OBSERVED_CLIENT]?: true };

function roundDuration(durationMs: number): number {
  return Math.round(durationMs * 10) / 10;
}

export function instrumentClient(
  client: QueryableClient,
  { enabled, clock = performance.now.bind(performance), log = logger }: ObservabilityOptions,
): void {
  const observedClient = client as ObservedClient;
  if (observedClient[OBSERVED_CLIENT]) return;
  observedClient[OBSERVED_CLIENT] = true;

  const dbLog = log.child({ mod: "db-pool" });
  const originalConnect = client.connect.bind(client);
  client.connect = ((callback?: (error?: Error) => void) => {
    const startedAt = clock();
    const finish = (success: boolean) => {
      if (!enabled) return;
      const fields = {
        durationMs: roundDuration(clock() - startedAt),
        success,
      };
      if (success) dbLog.info(fields, "database connection established");
      else dbLog.warn(fields, "database connection establishment failed");
    };

    if (callback) {
      return originalConnect((error?: Error) => {
        finish(!error);
        callback(error);
      });
    }

    return originalConnect().then(
      () => finish(true),
      (error: unknown) => {
        finish(false);
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
      if (!enabled) return;
      const fields = {
        durationMs: roundDuration(clock() - startedAt),
        success,
      };
      if (success) dbLog.info(fields, "database query finished");
      else dbLog.warn(fields, "database query failed");
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
  { enabled, clock = performance.now.bind(performance), log = logger }: ObservabilityOptions,
): void {
  const dbLog = log.child({ mod: "db-pool" });
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
    const finish = (success: boolean) => {
      if (!enabled) return;
      const fields = {
        durationMs: roundDuration(clock() - startedAt),
        success,
        waitingBefore,
        waitingAfter: pool.waitingCount,
        totalConnections: pool.totalCount,
        idleConnections: pool.idleCount,
      };
      if (success) dbLog.info(fields, "database connection acquired");
      else dbLog.warn(fields, "database connection acquisition failed");
    };

    if (callback) {
      return originalConnect((error, client, done) => {
        finish(!error);
        callback(error, client, done);
      });
    }

    return originalConnect().then(
      (client) => {
        finish(true);
        return client;
      },
      (error: unknown) => {
        finish(false);
        throw error;
      },
    );
  }) as Pool["connect"];
}

export function createObservedPool(
  config: PoolConfig,
  options: ObservabilityOptions,
): Pool {
  class InstrumentedClient extends Client {
    constructor(clientConfig?: string | ClientConfig) {
      super(clientConfig);
      instrumentClient(this, options);
    }
  }

  const pool = new Pool({ ...config, Client: InstrumentedClient });
  instrumentPoolAcquisition(pool, options);
  pool.on("error", () => {
    if (!options.enabled) return;
    (options.log ?? logger)
      .child({ mod: "db-pool" })
      .warn("idle database connection failed");
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
