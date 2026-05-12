import { env } from "@/config/env";
import type { components } from "./generated/certify";

export class IsometricApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: unknown,
    public readonly code?: "not_configured" | "network" | "http"
  ) {
    super(message);
    this.name = "IsometricApiError";
  }
}

const BASE_URLS = {
  sandbox: "https://api.sandbox.isometric.com/mrv/v0",
  production: "https://api.isometric.com/mrv/v0",
} as const;

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 8000;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRY_WAIT_MS = 30_000;

export interface IsometricRequestOptions {
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  /**
   * Opt in to retrying non-idempotent methods (POST/PATCH). Off by default to
   * prevent duplicate writes on transient retries.
   */
  allowUnsafeRetries?: boolean;
}

const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "OPTIONS", "PUT", "DELETE"]);

function isIdempotentMethod(method: string): boolean {
  return IDEMPOTENT_METHODS.has(method);
}

interface IsometricCredentials {
  clientSecret: string;
  accessToken: string;
  baseUrl: string;
}

function getCredentials(): IsometricCredentials {
  if (!env.ISOMETRIC_CLIENT_SECRET || !env.ISOMETRIC_ACCESS_TOKEN) {
    throw new IsometricApiError(
      "Isometric API not configured: set ISOMETRIC_CLIENT_SECRET and ISOMETRIC_ACCESS_TOKEN",
      undefined,
      undefined,
      "not_configured"
    );
  }
  return {
    clientSecret: env.ISOMETRIC_CLIENT_SECRET,
    accessToken: env.ISOMETRIC_ACCESS_TOKEN,
    baseUrl: BASE_URLS[env.ISOMETRIC_ENVIRONMENT],
  };
}

function buildUrl(
  base: string,
  path: string,
  query?: IsometricRequestOptions["query"]
): string {
  const url = new URL(`${base}${path.startsWith("/") ? path : `/${path}`}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function jitterDelayMs(attempt: number): number {
  const exp = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
  return Math.random() * exp;
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return undefined;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(signal.reason);
        },
        { once: true }
      );
    }
  });
}

export async function isometricRequest<T = unknown>(
  method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT",
  path: string,
  options: IsometricRequestOptions = {}
): Promise<T> {
  const { clientSecret, accessToken, baseUrl } = getCredentials();
  const url = buildUrl(baseUrl, path, options.query);

  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-Client-Secret": clientSecret,
    Authorization: `Bearer ${accessToken}`,
    ...options.headers,
  };

  const requestBody =
    options.body === undefined
      ? undefined
      : typeof options.body === "string"
        ? options.body
        : JSON.stringify(options.body);
  if (requestBody !== undefined && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (options.signal?.aborted) {
      throw options.signal.reason ?? new Error("Isometric request aborted");
    }
    const timeoutController = new AbortController();
    const timer = setTimeout(
      () => timeoutController.abort(new Error("Isometric request timed out")),
      REQUEST_TIMEOUT_MS
    );
    const onExternalAbort = () =>
      timeoutController.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", onExternalAbort, { once: true });

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: requestBody,
        signal: timeoutController.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onExternalAbort);
      if (options.signal?.aborted) throw options.signal.reason ?? err;
      const canRetry =
        isIdempotentMethod(method) || options.allowUnsafeRetries === true;
      if (!canRetry || attempt === MAX_ATTEMPTS) {
        throw new IsometricApiError(
          `Isometric ${method} ${path}: ${(err as Error).message ?? "network error"}`,
          undefined,
          undefined,
          "network"
        );
      }
      await sleep(jitterDelayMs(attempt), options.signal);
      continue;
    }
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onExternalAbort);

    if (response.ok) {
      if (response.status === 204) return undefined as T;
      const text = await response.text();
      if (!text) return undefined as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new IsometricApiError(
          `Isometric ${method} ${path}: malformed JSON in response body`,
          response.status,
          text,
          "http"
        );
      }
    }

    const bodyText = await response.text().catch(() => "");
    let bodyJson: unknown = bodyText;
    if (bodyText) {
      try {
        bodyJson = JSON.parse(bodyText);
      } catch {
        // keep raw text
      }
    }

    const canRetryMethod =
      isIdempotentMethod(method) || options.allowUnsafeRetries === true;
    const shouldRetry =
      canRetryMethod &&
      RETRYABLE_STATUS.has(response.status) &&
      attempt < MAX_ATTEMPTS;
    if (shouldRetry) {
      const retryAfterRaw = parseRetryAfter(
        response.headers.get("retry-after")
      );
      const retryAfter =
        retryAfterRaw !== undefined
          ? Math.min(retryAfterRaw, MAX_RETRY_WAIT_MS)
          : undefined;
      await sleep(retryAfter ?? jitterDelayMs(attempt), options.signal);
      continue;
    }

    throw new IsometricApiError(
      `Isometric ${method} ${path} → ${response.status}`,
      response.status,
      bodyJson,
      "http"
    );
  }

  // Unreachable: the loop always returns or throws.
  throw new IsometricApiError(
    `Isometric ${method} ${path}: exhausted retries`,
    undefined,
    undefined,
    "network"
  );
}

type Paginated<T> = {
  nodes: T[];
  page_info: components["schemas"]["PageInfo"];
  total_count: number;
};

export interface PaginateOptions extends IsometricRequestOptions {
  pageSize?: number;
}

export async function* paginate<T>(
  path: string,
  options: PaginateOptions = {}
): AsyncGenerator<T> {
  const { pageSize = 50, query, ...rest } = options;
  let after: string | undefined;
  while (true) {
    const page = await isometricRequest<Paginated<T>>("GET", path, {
      ...rest,
      query: { ...query, first: pageSize, after },
    });
    for (const node of page.nodes ?? []) yield node;
    if (!page.page_info?.has_next_page || !page.page_info.end_cursor) return;
    after = page.page_info.end_cursor;
  }
}

export async function paginateAll<T>(
  path: string,
  options: PaginateOptions = {}
): Promise<T[]> {
  const out: T[] = [];
  for await (const node of paginate<T>(path, options)) out.push(node);
  return out;
}

export const isometric = {
  get: <T = unknown>(path: string, options?: IsometricRequestOptions) =>
    isometricRequest<T>("GET", path, options),
  post: <T = unknown>(
    path: string,
    body?: unknown,
    options?: IsometricRequestOptions
  ) => isometricRequest<T>("POST", path, { ...options, body }),
  patch: <T = unknown>(
    path: string,
    body?: unknown,
    options?: IsometricRequestOptions
  ) => isometricRequest<T>("PATCH", path, { ...options, body }),
  delete: <T = unknown>(path: string, options?: IsometricRequestOptions) =>
    isometricRequest<T>("DELETE", path, options),
  paginate,
  paginateAll,
};

export type IsometricEnvironment = (typeof BASE_URLS) extends Record<
  infer K,
  string
>
  ? K
  : never;
