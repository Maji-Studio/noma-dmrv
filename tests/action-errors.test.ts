/**
 * toLoggedActionError Tests (issue #251)
 *
 * Server actions must never return raw Drizzle/Postgres error text (SQL +
 * bound params) to the client. toLoggedActionError logs the real error
 * server-side and returns either a SafeError message verbatim or the
 * generic fallback.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockLoggerError = vi.fn();

vi.mock("@/lib/log", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/log")>();
  return {
    ...actual,
    logger: {
      ...actual.logger,
      error: (...args: unknown[]) => mockLoggerError(...args),
    },
  };
});

import { toLoggedActionError } from "@/fn/action-errors";
import { SafeError } from "@/lib/errors";

const RAW_DB_ERROR =
  'Failed query: insert into "production_runs" ("id", "residence_time_minutes") values ($1, $2) -- params: ["11111111-1111-4111-8111-111111111111", 3000000000]';

describe("toLoggedActionError", () => {
  beforeEach(() => {
    mockLoggerError.mockReset();
  });

  it("suppresses raw DB error text and returns the fallback", () => {
    const result = toLoggedActionError(
      new Error(RAW_DB_ERROR),
      "Failed to create production run",
      {
        message: "production run action failed",
        context: { op: "production-run:create" },
      },
    );

    expect(result).toBe("Failed to create production run");
    expect(result).not.toMatch(/insert into/);
    expect(result).not.toMatch(/params:/);
  });

  it("logs the real error server-side with a sanitized message", () => {
    toLoggedActionError(new Error(RAW_DB_ERROR), "Failed to create production run", {
      message: "production run action failed",
      context: { op: "production-run:create" },
    });

    expect(mockLoggerError).toHaveBeenCalledOnce();
    const [context, message] = mockLoggerError.mock.calls[0] as [
      Record<string, unknown>,
      string,
    ];
    expect(message).toBe("production run action failed");
    expect(context).toMatchObject({
      op: "production-run:create",
      errorName: "Error",
    });
    // The full (sanitized) error text goes to the server log, not the client.
    expect(context.errorMessage).toContain("insert into");
  });

  it("returns SafeError messages verbatim without logging", () => {
    const result = toLoggedActionError(
      new SafeError("Delivery not found"),
      "Failed to load delivery",
      { message: "delivery action failed", context: { op: "delivery:get" } },
    );

    expect(result).toBe("Delivery not found");
    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  it("returns the fallback for non-Error throws and still logs them", () => {
    const result = toLoggedActionError("string error", "Failed to load samples", {
      message: "sample action failed",
      context: { op: "sample:list" },
    });

    expect(result).toBe("Failed to load samples");
    expect(mockLoggerError).toHaveBeenCalledOnce();
    const [context] = mockLoggerError.mock.calls[0] as [Record<string, unknown>];
    expect(context.errorName).toBe("string");
    expect(context.errorMessage).toBe("string error");
  });
});
