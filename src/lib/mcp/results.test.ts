import { beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { DomainError } from "@/lib/domain-errors";
import type { ApiRouteContext } from "@/lib/api/route";
import { apiResponseHeaders } from "@/lib/api/problem";
import { toolErrorSchema, toolFailure, toolSuccess } from "./results";
import { parseQueryInput } from "@/lib/api/query";
import { lookupListSchema } from "@/lib/api/query-schemas";

const mocks = vi.hoisted(() => ({ log: vi.fn() }));
vi.mock("@/lib/log", () => ({ logger: { error: mocks.log } }));
beforeEach(() => vi.clearAllMocks());
const context = { requestId: "request-1", instance: "/api/mcp", headers: apiResponseHeaders("request-1"), deadlineAt: 0 } as ApiRouteContext;
it.each([
  ["find_facilities", { q: "bad\u0000value" }, lookupListSchema, "/q"],
  ["find_feedstocks", { cursor: "bad\tvalue" }, lookupListSchema, "/cursor"],
])("returns invalid_query with issue pointers for %s control characters", async (name, input, schema, pointer) => {
  let error: unknown;
  try {
    parseQueryInput(input, schema);
  } catch (failure) {
    error = failure;
  }
  const result = await toolFailure(error, context, name);
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toEqual({
    code: "invalid_query", detail: "Send query values without control characters.", retryable: false,
    issues: [{ pointer, code: "custom", detail: "Query values must not contain control characters." }],
  });
});
it("keeps both branches within the published output union without HTTP fields", async () => {
  const output = z.union([z.object({ data: z.object({ id: z.string() }) }), toolErrorSchema]);
  const success = toolSuccess({ data: { id: "resource-1" } }, "Resource retrieved.");
  expect(output.safeParse(success.structuredContent).success).toBe(true);
  const failure = await toolFailure(new DomainError("validation_failed", "Check the field.", {
    issues: [{ path: ["field/with~", 0], code: "invalid_value", message: "Check the field." }],
  }), context, "test_tool");
  expect(output.safeParse(failure.structuredContent).success).toBe(true);
  expect(failure.structuredContent).toEqual({ code: "validation_failed", detail: "Check the field.", retryable: false,
    issues: [{ pointer: "/field~1with~0/0", code: "invalid_value", detail: "Check the field." }] });
});


it.each(["outcome_unknown", "deadline_exceeded"] as const)("logs %s without a cause once and sanitizes it", async (code) => {
  const failure = await toolFailure(new DomainError(code, "private-input"), context, "test_tool");
  expect(failure.structuredContent).toMatchObject({
    code, detail: "The request could not be completed.", retryable: true, issues: [],
  });
  expect(mocks.log).toHaveBeenCalledOnce();
  expect(mocks.log).toHaveBeenCalledWith(
    { op: "test_tool", requestId: context.requestId, errorName: "DomainError", code },
    "API request failed",
  );
});
