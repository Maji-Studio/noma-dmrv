/**
 * withAction Helper Tests
 *
 * Verifies auth, error handling, and ActionResult formatting.
 */
import { describe, it, expect, vi } from "vitest";
import { z } from "zod";

vi.mock("@/lib/auth/server", () => ({
  getUser: vi.fn(),
}));

import { withAction } from "@/fn/with-action";
import { SafeError } from "@/lib/errors";
import { getUser } from "@/lib/auth/server";

const mockUser = {
  id: "user-123",
  email: "test@example.com",
  name: "Test",
  emailVerified: true,
  role: "admin" as const,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
};

describe("withAction", () => {
  it("returns Unauthorized when getUser returns null", async () => {
    vi.mocked(getUser).mockResolvedValue(null);

    const result = await withAction(async () => "data");

    expect(result).toEqual({ success: false, error: "Unauthorized" });
  });

  it("returns Unauthorized when user has no id", async () => {
    vi.mocked(getUser).mockResolvedValue({ ...mockUser, id: "" } as never);

    const result = await withAction(async () => "data");

    expect(result).toEqual({ success: false, error: "Unauthorized" });
  });

  it("passes userId to callback and returns success result", async () => {
    vi.mocked(getUser).mockResolvedValue(mockUser);

    const result = await withAction(async (userId) => {
      return { receivedUserId: userId };
    });

    expect(result).toEqual({
      success: true,
      data: { receivedUserId: "user-123" },
    });
  });

  it("formats ZodError with default prefix", async () => {
    vi.mocked(getUser).mockResolvedValue(mockUser);

    const schema = z.object({ name: z.string().min(1, "Name is required") });

    const result = await withAction(async () => {
      schema.parse({ name: "" });
    });

    expect(result).toEqual({
      success: false,
      error: "Validation error: Name is required",
    });
  });

  it("formats ZodError with custom zodErrorPrefix", async () => {
    vi.mocked(getUser).mockResolvedValue(mockUser);

    const schema = z.object({ page: z.number().min(1, "Page must be positive") });

    const result = await withAction(async () => {
      schema.parse({ page: 0 });
    }, { zodErrorPrefix: "Invalid filter parameters" });

    expect(result).toEqual({
      success: false,
      error: "Invalid filter parameters: Page must be positive",
    });
  });

  it("forwards SafeError.message verbatim", async () => {
    vi.mocked(getUser).mockResolvedValue(mockUser);

    const result = await withAction(async () => {
      throw new SafeError("Order not found");
    });

    expect(result).toEqual({
      success: false,
      error: "Order not found",
    });
  });

  it("suppresses plain Error.message in non-dev mode", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.mocked(getUser).mockResolvedValue(mockUser);

    try {
      const result = await withAction(async () => {
        throw new Error("DB connection refused");
      });

      expect(result).toEqual({
        success: false,
        error: "An unexpected error occurred",
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("uses default fallbackMessage for non-Error throws", async () => {
    vi.mocked(getUser).mockResolvedValue(mockUser);

    const result = await withAction(async () => {
      throw "string error";
    });

    expect(result).toEqual({
      success: false,
      error: "An unexpected error occurred",
    });
  });

  it("uses custom fallbackMessage for non-Error throws", async () => {
    vi.mocked(getUser).mockResolvedValue(mockUser);

    const result = await withAction(async () => {
      throw 42;
    }, { fallbackMessage: "Failed to create order" });

    expect(result).toEqual({
      success: false,
      error: "Failed to create order",
    });
  });
});
