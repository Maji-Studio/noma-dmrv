/**
 * withAction Helper Tests
 *
 * Verifies auth, error handling, and ActionResult formatting.
 */
import { describe, it, expect, vi } from "vitest";
import { z } from "zod";

vi.mock("@/lib/auth/server", () => ({
  requireOrgContext: vi.fn(),
}));

vi.mock("@/lib/log", () => ({
  logger: {
    error: vi.fn(),
  },
  sanitizeErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}));

import { withAction } from "@/fn/with-action";
import { ActionConflictError, SafeError, toActionError } from "@/lib/errors";
import { logger } from "@/lib/log";
import { requireOrgContext } from "@/lib/auth/server";
import { makeTestOrgContext } from "./helpers/test-org";

const mockUser = {
  id: "user-123",
  email: "test@example.com",
  name: "Test",
  emailVerified: true,
  role: "admin" as const,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
};
const TEST_CTX = makeTestOrgContext(mockUser.id);

describe("withAction", () => {
  it("returns the org-context guard error when no organization is active", async () => {
    vi.mocked(requireOrgContext).mockRejectedValue(
      new SafeError("Select an Organization to continue."),
    );

    const result = await withAction(async () => "data");

    expect(result).toEqual({
      success: false,
      error: "Select an Organization to continue.",
    });
  });

  it("returns Unauthorized when the context guard rejects the user", async () => {
    vi.mocked(requireOrgContext).mockRejectedValue(new SafeError("Unauthorized"));

    const result = await withAction(async () => "data");

    expect(result).toEqual({ success: false, error: "Unauthorized" });
  });

  it("passes OrgContext to callback and returns success result", async () => {
    vi.mocked(requireOrgContext).mockResolvedValue(TEST_CTX);

    const result = await withAction(async (ctx) => {
      return { receivedContext: ctx };
    });

    expect(result).toEqual({
      success: true,
      data: { receivedContext: TEST_CTX },
    });
  });

  it("formats ZodError without a generic prefix", async () => {
    vi.mocked(requireOrgContext).mockResolvedValue(TEST_CTX);

    const schema = z.object({ name: z.string().min(1, "Name is required") });

    const result = await withAction(async () => {
      schema.parse({ name: "" });
    });

    expect(result).toEqual({
      success: false,
      error: "Name is required.",
    });
  });

  it("formats ZodError with custom zodErrorPrefix", async () => {
    vi.mocked(requireOrgContext).mockResolvedValue(TEST_CTX);

    const schema = z.object({ page: z.number().min(1, "Page must be positive") });

    const result = await withAction(async () => {
      schema.parse({ page: 0 });
    }, { zodErrorPrefix: "Invalid filter parameters" });

    expect(result).toEqual({
      success: false,
      error: "Invalid filter parameters: Page must be positive.",
    });
  });

  it("forwards SafeError.message verbatim", async () => {
    vi.mocked(requireOrgContext).mockResolvedValue(TEST_CTX);

    const result = await withAction(async () => {
      throw new SafeError("Order not found");
    });

    expect(result).toEqual({
      success: false,
      error: "Order was not found.",
    });
  });

  it("suppresses plain Error.message in non-dev mode", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.mocked(requireOrgContext).mockResolvedValue(TEST_CTX);

    try {
      const result = await withAction(async () => {
        throw new Error("DB connection refused");
      });

      expect(result).toEqual({
        success: false,
        error: "The action could not be completed. Try again.",
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("suppresses raw database-like Error.message in default mode", async () => {
    vi.mocked(requireOrgContext).mockResolvedValue(TEST_CTX);

    const result = await withAction(async () => {
      throw new Error(
        'Failed query: insert into "storage_locations" values ($1) -- params: ["11111111-1111-4111-8111-111111111111"]',
      );
    }, { fallbackMessage: "Failed to create storage location" });

    expect(result).toEqual({
      success: false,
      error: "Storage location was not created. Try again.",
    });
  });

  it("uses default fallbackMessage for non-Error throws", async () => {
    vi.mocked(requireOrgContext).mockResolvedValue(TEST_CTX);

    const result = await withAction(async () => {
      throw "string error";
    });

    expect(result).toEqual({
      success: false,
      error: "The action could not be completed. Try again.",
    });
  });

  it("uses custom fallbackMessage for non-Error throws", async () => {
    vi.mocked(requireOrgContext).mockResolvedValue(TEST_CTX);

    const result = await withAction(async () => {
      throw 42;
    }, { fallbackMessage: "Failed to create order" });

    expect(result).toEqual({
      success: false,
      error: "Order was not created. Try again.",
    });
  });

  it("logs unexpected errors with the caller's message and context", async () => {
    vi.mocked(requireOrgContext).mockResolvedValue(TEST_CTX);
    vi.mocked(logger.error).mockClear();

    const result = await withAction(
      async () => {
        throw new Error("boom");
      },
      {
        fallbackMessage: "Failed to load reactor",
        log: { message: "reactor action failed", context: { op: "reactor:get" } },
      },
    );

    expect(result).toEqual({
      success: false,
      error: toActionError(new Error("boom"), "Failed to load reactor"),
    });
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ op: "reactor:get", errorName: "Error" }),
      "reactor action failed",
    );
  });

  it("logs unexpected errors as a generic server action failure by default", async () => {
    vi.mocked(requireOrgContext).mockResolvedValue(TEST_CTX);
    vi.mocked(logger.error).mockClear();

    await withAction(async () => {
      throw new Error("boom");
    });

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ errorName: "Error" }),
      "server action failed",
    );
  });

  it("answers with the mapped result and skips logging when mapError claims the error", async () => {
    class StockOverdrawError extends SafeError {}
    vi.mocked(requireOrgContext).mockResolvedValue(TEST_CTX);
    vi.mocked(logger.error).mockClear();

    const result = await withAction(
      async () => {
        throw new StockOverdrawError("Not enough biochar in the bin.");
      },
      {
        mapError: (error) =>
          error instanceof StockOverdrawError
            ? { success: false as const, error: error.message, field: "lossMassKg" as const }
            : undefined,
      },
    );
    // The mapped shape survives the action's result type.
    const failure = result as { success: false; error: string; field: "lossMassKg" };
    expect(failure.field).toBe("lossMassKg");

    expect(result).toEqual({
      success: false,
      error: "Not enough biochar in the bin.",
      field: "lossMassKg",
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("falls through to the logged fallback when mapError returns undefined", async () => {
    vi.mocked(requireOrgContext).mockResolvedValue(TEST_CTX);
    vi.mocked(logger.error).mockClear();

    const result = await withAction(
      async () => {
        throw new Error("boom");
      },
      {
        fallbackMessage: "Failed to record loss",
        mapError: () => undefined,
      },
    );

    expect(result).toEqual({
      success: false,
      error: toActionError(new Error("boom"), "Failed to record loss"),
    });
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("keeps the Zod and conflict branches ahead of mapError", async () => {
    vi.mocked(requireOrgContext).mockResolvedValue(TEST_CTX);
    const mapError = vi.fn(() => ({ success: false as const, error: "mapped" }));

    const zodResult = await withAction(async () => {
      z.object({ name: z.string().min(1, "Name is required") }).parse({ name: "" });
    }, { mapError });
    const conflict = { entity: "productionRun", id: "run-1", code: "PR-001" };
    const conflictResult = await withAction(async () => {
      throw new ActionConflictError("Overlaps PR-001.", conflict);
    }, { mapError });

    expect(zodResult).toEqual({ success: false, error: "Name is required." });
    expect(conflictResult).toEqual({
      success: false,
      error: "Overlaps PR-001.",
      conflict,
    });
    expect(mapError).not.toHaveBeenCalled();
  });
});
