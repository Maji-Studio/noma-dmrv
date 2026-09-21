import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mocks = vi.hoisted(() => {
  // `@/db` calls `logger.child` at module load and the pool calls `child`
  // again on the result (see the waiver in docs/architecture.md).
  const logger = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    child: () => logger,
  };
  return { resolveOrgContext: vi.fn(), logger };
});

vi.mock("@/lib/auth/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/server")>();
  return { ...actual, resolveOrgContext: mocks.resolveOrgContext };
});
vi.mock("@/lib/log", () => ({
  logger: mocks.logger,
  sanitizeErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}));

import { conflictCode } from "@/lib/conflict-ref";
import { ActionConflictError, SafeError } from "@/lib/errors";
import { readInput, readResponse } from "./read-response";

const ORG_CONTEXT = {
  userId: "user-1",
  organizationId: "org-1",
  orgRole: "member" as const,
  isPlatformAdmin: false,
};

function request(body: string, headers?: HeadersInit): Request {
  return new Request("https://app.example/api/reads/test", {
    method: "POST",
    body,
    headers,
  });
}

const OVERSIZED_BODY_ERROR =
  "The request was too large to read. Narrow the filters and try again.";

describe("authenticated read response", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveOrgContext.mockResolvedValue({ ok: true, ctx: ORG_CONTEXT });
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

  it("answers 401 when the caller has no session", async () => {
    mocks.resolveOrgContext.mockResolvedValue({
      ok: false,
      denial: "unauthenticated",
    });
    const read = vi.fn();

    const response = await readResponse({
      fallbackMessage: "Failed to load records",
      logContext: "read:test",
      read,
    });

    expect(response.status).toBe(401);
    expect(read).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: "Sign in to continue.",
    });
  });

  it("answers 403 when the caller has no usable organization", async () => {
    mocks.resolveOrgContext.mockResolvedValue({
      ok: false,
      denial: "no-organization",
    });

    const response = await readResponse({
      fallbackMessage: "Failed to load records",
      logContext: "read:test",
      read: async () => "data",
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: "Select an Organization to continue.",
    });
  });

  it("formats invalid inputs without exposing internals", async () => {
    const response = await readResponse({
      fallbackMessage: "Failed to load records",
      invalidInputContext: "Invalid read parameters",
      logContext: "read:test",
      read: async () => z.uuid("Choose a valid record.").parse("bad"),
    });

    expect(response.status).toBe(400);
    expect(mocks.logger.error).not.toHaveBeenCalled();
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

  it("keeps the conflict branch the Server Action wrapper returns", async () => {
    const conflict = { entity: "productionRun", id: "run-1", code: conflictCode("PR-001") };

    const response = await readResponse({
      fallbackMessage: "Failed to load records",
      logContext: "read:test",
      read: async () => {
        throw new ActionConflictError("Overlaps PR-001.", conflict);
      },
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: "Overlaps PR-001.",
      conflict,
    });
  });

  it("logs an unexpected failure and answers 500 with the fallback message", async () => {
    const response = await readResponse({
      fallbackMessage: "Failed to load records",
      invalidInputContext: "Invalid read parameters",
      logContext: "read:test",
      read: async () => {
        throw new Error("connection terminated");
      },
    });

    expect(response.status).toBe(500);
    expect(mocks.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ op: "read:test" }),
      "authenticated read failed",
    );
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: "Records could not be loaded. Refresh the page and try again.",
    });
  });

  // Resolving the context reads the database, so it can fail like any other
  // query. That must be logged and answered, not escape the handler.
  it("answers 500 when resolving the org context itself fails", async () => {
    mocks.resolveOrgContext.mockRejectedValue(
      new Error("connection terminated unexpectedly"),
    );
    const read = vi.fn();

    const response = await readResponse({
      fallbackMessage: "Failed to load records",
      logContext: "read:test",
      read,
    });

    expect(response.status).toBe(500);
    expect(read).not.toHaveBeenCalled();
    expect(mocks.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ op: "read:test" }),
      "authenticated read failed",
    );
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: "Records could not be loaded. Refresh the page and try again.",
    });
  });

  // A JSON.parse fault inside a read (stored metadata, a driver payload) is a
  // server fault, not a report that the operator's input was wrong.
  it("reports a SyntaxError raised inside a read as a server failure", async () => {
    const response = await readResponse({
      fallbackMessage: "Failed to load records",
      invalidInputContext: "Invalid read parameters",
      logContext: "read:test",
      read: async () => JSON.parse("{ not json"),
    });

    expect(response.status).toBe(500);
    expect(mocks.logger.error).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: "Records could not be loaded. Refresh the page and try again.",
    });
  });
});

describe("read input decoding", () => {
  it("treats an empty body as no input", async () => {
    await expect(readInput(request(""))).resolves.toBeUndefined();
  });

  it("decodes a JSON body", async () => {
    await expect(readInput(request('{"page":2}'))).resolves.toEqual({
      page: 2,
    });
  });

  it("rejects a malformed body as a safe bad request", async () => {
    await expect(readInput(request("<html>"))).rejects.toThrow(
      "The request could not be read. Refresh the page and try again.",
    );
  });

  it("refuses a body larger than the read cap", async () => {
    const oversized = JSON.stringify({ search: "x".repeat(17 * 1024) });

    await expect(readInput(request(oversized))).rejects.toThrow(
      OVERSIZED_BODY_ERROR,
    );
  });

  it("refuses an oversized body before buffering it", async () => {
    await expect(
      readInput(request("{}", { "content-length": String(64 * 1024) })),
    ).rejects.toThrow(OVERSIZED_BODY_ERROR);
  });
});
