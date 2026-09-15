import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mocks = vi.hoisted(() => ({
  requireOrgContext: vi.fn(),
}));

vi.mock("@/lib/auth/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/server")>();
  return { ...actual, requireOrgContext: mocks.requireOrgContext };
});

import { SafeError } from "@/lib/errors";
import { readResponse } from "./read-response";

const ORG_CONTEXT = {
  userId: "user-1",
  organizationId: "org-1",
  orgRole: "member" as const,
  isPlatformAdmin: false,
};

describe("authenticated read response", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOrgContext.mockResolvedValue(ORG_CONTEXT);
  });

  it("returns private no-store JSON and serializes Date values as ISO strings", async () => {
    const response = await readResponse({
      fallbackMessage: "Failed to load records",
      logContext: "read:test",
      read: async (ctx) => ({
        organizationId: ctx.organizationId,
        createdAt: new Date("2026-09-15T10:00:00.000Z"),
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toContain("Cookie");
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        organizationId: "org-1",
        createdAt: "2026-09-15T10:00:00.000Z",
      },
    });
  });

  it("formats invalid inputs without exposing internals", async () => {
    const response = await readResponse({
      fallbackMessage: "Failed to load records",
      invalidInputContext: "Invalid read parameters",
      logContext: "read:test",
      read: async () => z.string().uuid("Choose a valid record.").parse("bad"),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: "Invalid read parameters: Choose a valid record.",
    });
  });

  it("preserves safe organization errors", async () => {
    const response = await readResponse({
      fallbackMessage: "Failed to load records",
      logContext: "read:test",
      read: async () => {
        throw new SafeError("Facility not found in this organization");
      },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: "Facility was not found in this Organization.",
    });
  });
});
