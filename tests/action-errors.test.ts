/**
 * toLoggedActionError Tests (issue #251)
 *
 * Server actions must never return raw Drizzle/Postgres error text (SQL +
 * bound params) to the client. toLoggedActionError logs the real error
 * server-side and returns either a SafeError message verbatim or the
 * generic fallback.
 *
 * The server-log contract is also constrained: bound params carry arbitrary
 * user data (names, phone numbers, addresses), so only the parameterized SQL
 * shape may reach the log — the `params:` section must be redacted.
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

import {
  isDatabaseSchemaMismatchError,
  toLoggedActionError,
} from "@/fn/action-errors";
import { SafeError } from "@/lib/errors";

// Drizzle's DrizzleQueryError format: `Failed query: <sql>\nparams: <values>`.
// The bound values deliberately include PII-shaped data (fake) to pin that it
// never reaches the server log.
const RAW_DB_ERROR =
  'Failed query: update "suppliers" set "contact_name" = $1, "contact_phone" = $2 where "suppliers"."id" = $3\nparams: ["Jane Fakename","+15550100000","11111111-1111-4111-8111-111111111111"]';

describe("toLoggedActionError", () => {
  beforeEach(() => {
    mockLoggerError.mockReset();
  });

  it("suppresses raw DB error text and returns the fallback", () => {
    const result = toLoggedActionError(
      new Error(RAW_DB_ERROR),
      "Failed to update supplier",
      {
        message: "supplier action failed",
        context: { op: "supplier:update" },
      },
    );

    expect(result).toBe("Supplier was not saved. Try again.");
    expect(result).not.toMatch(/update "suppliers"/);
    expect(result).not.toMatch(/params:/);
  });

  it("logs the SQL shape server-side but never the bound params", () => {
    toLoggedActionError(new Error(RAW_DB_ERROR), "Failed to update supplier", {
      message: "supplier action failed",
      context: { op: "supplier:update" },
    });

    expect(mockLoggerError).toHaveBeenCalledOnce();
    const [context, message] = mockLoggerError.mock.calls[0] as [
      Record<string, unknown>,
      string,
    ];
    expect(message).toBe("supplier action failed");
    expect(context).toMatchObject({
      op: "supplier:update",
      errorName: "Error",
    });
    // The parameterized SQL (placeholders only) is kept for debuggability…
    expect(context.errorMessage).toContain('update "suppliers"');
    // …but the params section — which carries literal user data — is redacted.
    expect(context.errorMessage).toContain("params: [REDACTED]");
    expect(context.errorMessage).not.toContain("Jane Fakename");
    expect(context.errorMessage).not.toContain("+15550100000");
  });

  it("returns SafeError messages verbatim without logging", () => {
    const result = toLoggedActionError(
      new SafeError("Delivery not found"),
      "Failed to load delivery",
      { message: "delivery action failed", context: { op: "delivery:get" } },
    );

    expect(result).toBe(
      "Delivery was not found. Refresh the page and try again.",
    );
    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  it("returns the fallback for non-Error throws and still logs them", () => {
    const result = toLoggedActionError("string error", "Failed to load samples", {
      message: "sample action failed",
      context: { op: "sample:list" },
    });

    expect(result).toBe("Samples could not be loaded. Refresh the page and try again.");
    expect(mockLoggerError).toHaveBeenCalledOnce();
    const [context] = mockLoggerError.mock.calls[0] as [Record<string, unknown>];
    expect(context.errorName).toBe("string");
    expect(context.errorMessage).toBe("string error");
  });

  it("uses natural agreement for plural fallback subjects", () => {
    const result = toLoggedActionError(
      new Error("registry unavailable"),
      "Failed to save Isometric credentials",
      {
        message: "credential action failed",
        context: { op: "credentials:save" },
      },
    );

    expect(result).toBe("Isometric credentials were not saved. Try again.");
  });

  it("keeps unknown fallback verbs grammatical", () => {
    const result = toLoggedActionError(
      new Error("database unavailable"),
      "Failed to change member role",
      {
        message: "member action failed",
        context: { op: "member:update" },
      },
    );

    expect(result).toBe(
      "The action to change member role could not be completed. Try again.",
    );
  });
});

describe("isDatabaseSchemaMismatchError", () => {
  it("detects a PostgreSQL undefined-column error nested by Drizzle", () => {
    const postgresError = Object.assign(
      new Error('column applications.gis_boundary does not exist'),
      { code: "42703" },
    );
    const drizzleError = new Error("Failed query", { cause: postgresError });

    expect(isDatabaseSchemaMismatchError(drizzleError)).toBe(true);
  });

  it("does not classify ordinary query failures as schema mismatches", () => {
    const postgresError = Object.assign(new Error("connection timeout"), {
      code: "ETIMEDOUT",
    });
    const drizzleError = new Error("Failed query", { cause: postgresError });

    expect(isDatabaseSchemaMismatchError(drizzleError)).toBe(false);
    expect(isDatabaseSchemaMismatchError(new Error("Failed query"))).toBe(false);
  });
});
