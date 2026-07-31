import { beforeEach, describe, expect, it, vi } from "vitest";

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
  });

  it("returns safe validation errors in the stream", async () => {
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

    const event = JSON.parse((await response.text()).trim());
    expect(event.type).toBe("error");
    expect(event.error).toContain("Validation error:");
    expect(mocks.submitRemoval).not.toHaveBeenCalled();
  });
});
