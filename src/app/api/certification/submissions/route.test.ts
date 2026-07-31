import { beforeEach, describe, expect, it, vi } from "vitest";
import { SafeError } from "@/lib/errors";

const mocks = vi.hoisted(() => ({
  requireOrgContext: vi.fn(),
  requireOrgRole: vi.fn(),
  checkRateLimit: vi.fn(),
  submitRemoval: vi.fn(),
  submitGhgStatement: vi.fn(),
  logActionError: vi.fn(),
}));

vi.mock("@/lib/auth/server", () => ({
  requireOrgContext: mocks.requireOrgContext,
  requireOrgRole: mocks.requireOrgRole,
}));
vi.mock("@/lib/rate-limit/in-memory", () => ({
  checkRateLimit: mocks.checkRateLimit,
}));
vi.mock("@/fn/certification/submit-removal", () => ({
  submitRemoval: mocks.submitRemoval,
}));
vi.mock("@/fn/certification/submit-ghg-statement", () => ({
  submitGhgStatementToVerifierCore: mocks.submitGhgStatement,
}));
vi.mock("@/fn/action-errors", () => ({
  logActionError: mocks.logActionError,
}));

import { POST } from "./route";

const ORG_CONTEXT = {
  userId: "user-1",
  organizationId: "org-1",
  orgRole: "admin",
  isPlatformAdmin: false,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireOrgContext.mockResolvedValue(ORG_CONTEXT);
  mocks.requireOrgRole.mockReturnValue(undefined);
  mocks.checkRateLimit.mockReturnValue({
    allowed: true,
    retryAfterSeconds: 0,
  });
});

describe("certification submission progress route", () => {
  it("streams Removal progress and the final result", async () => {
    mocks.submitRemoval.mockImplementation(async (args) => {
      args.onProgress({
        step: "removal.checking_data",
        state: "complete",
      });
      return { removalId: args.removalId, externalId: "rm-1", version: 1 };
    });
    const response = await POST(
      new Request("http://localhost/api/certification/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "removal",
          input: {
            removalId: "11111111-1111-4111-8111-111111111111",
            compilationHash: "a".repeat(64),
          },
        }),
      }),
    );

    const events = (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events).toEqual([
      {
        type: "progress",
        update: { step: "removal.checking_data", state: "complete" },
      },
      {
        type: "result",
        result: {
          removalId: "11111111-1111-4111-8111-111111111111",
          externalId: "rm-1",
          version: 1,
        },
      },
    ]);
    expect(response.headers.get("content-type")).toContain(
      "application/x-ndjson",
    );
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    expect(mocks.requireOrgRole).toHaveBeenCalledWith(ORG_CONTEXT, "admin");
  });

  it("returns 400 before opening a stream for an invalid request", async () => {
    const response = await POST(
      new Request("http://localhost/api/certification/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "removal",
          input: { removalId: "not-a-uuid", compilationHash: "bad" },
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({
      error: "Invalid submission request.",
    });
    expect(mocks.submitRemoval).not.toHaveBeenCalled();
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed JSON", async () => {
    const response = await POST(
      new Request("http://localhost/api/certification/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.submitRemoval).not.toHaveBeenCalled();
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
  });

  it("denies non-admin callers before parsing or starting submission work", async () => {
    mocks.requireOrgRole.mockImplementation(() => {
      throw new SafeError("You don't have permission to perform this action.");
    });
    const json = vi.fn();

    const response = await POST({ json } as unknown as Request);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "You don't have permission to perform this action.",
    });
    expect(mocks.requireOrgRole).toHaveBeenCalledWith(ORG_CONTEXT, "admin");
    expect(json).not.toHaveBeenCalled();
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(mocks.submitRemoval).not.toHaveBeenCalled();
    expect(mocks.submitGhgStatement).not.toHaveBeenCalled();
  });

  it("passes the authenticated org context and parsed GHG Statement input to the core", async () => {
    const ghgStatementId = "22222222-2222-4222-8222-222222222222";
    const input = {
      reportId: "33333333-3333-4333-8333-333333333333",
      confirmProduction: true,
    };
    mocks.submitGhgStatement.mockResolvedValue({
      externalId: "ghg-1",
      remoteStatus: "AWAITING_VERIFICATION",
    });

    const response = await POST(
      new Request("http://localhost/api/certification/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "ghg_statement", ghgStatementId, input }),
      }),
    );
    await response.text();

    expect(response.status).toBe(200);
    expect(mocks.submitGhgStatement).toHaveBeenCalledWith({
      orgCtx: ORG_CONTEXT,
      ghgStatementId,
      input,
      onProgress: expect.any(Function),
    });
    expect(mocks.submitRemoval).not.toHaveBeenCalled();
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "cert:submit-ghg-statement:user-1",
      }),
    );
  });

  it("returns 429 before starting submission work when the limit is exhausted", async () => {
    mocks.checkRateLimit.mockReturnValue({
      allowed: false,
      retryAfterSeconds: 17,
    });

    const response = await POST(
      new Request("http://localhost/api/certification/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "removal",
          input: {
            removalId: "11111111-1111-4111-8111-111111111111",
            compilationHash: "a".repeat(64),
          },
        }),
      }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("17");
    await expect(response.json()).resolves.toEqual({
      error: "Too many attempts. Try again in 17s.",
    });
    expect(mocks.submitRemoval).not.toHaveBeenCalled();
    expect(mocks.submitGhgStatement).not.toHaveBeenCalled();
  });
});
