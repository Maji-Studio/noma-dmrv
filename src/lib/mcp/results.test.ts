import { expect, it, vi } from "vitest";
import { z } from "zod";
import { DomainError } from "@/lib/domain-errors";
import type { ApiRouteContext } from "@/lib/api/route";
import { apiResponseHeaders } from "@/lib/api/problem";
import { toolErrorSchema, toolFailure, toolSuccess } from "./results";

vi.mock("@/lib/log", () => ({ logger: { error: vi.fn() } }));
const context = { requestId: "request-1", instance: "/api/mcp", headers: apiResponseHeaders("request-1"), deadlineAt: 0 } as ApiRouteContext;
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
