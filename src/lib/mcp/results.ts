import { z } from "zod";
import { ProtocolError, ProtocolErrorCode } from "@modelcontextprotocol/server";
import { problemSchema } from "@/lib/api/problem-schema";
import { actionFailureResponse, problemResponse } from "@/lib/api/problem";
import { ApiHttpError } from "@/lib/api/http-error";
import { logApiError } from "@/lib/api/route-error";
import type { ApiRouteContext } from "@/lib/api/route";
import { DomainError } from "@/lib/domain-errors";
import { toActionFailure } from "@/fn/action-errors";

/** REST's `errors` become MCP `issues`; HTTP metadata does not cross transports. */
export const toolErrorSchema = problemSchema.pick({ code: true, detail: true, retryable: true, conflict: true, blockers: true })
  .extend({ issues: problemSchema.shape.errors });

export function toolSuccess(structuredContent: Record<string, unknown>, text: string) {
  return { content: [{ type: "text" as const, text }], structuredContent };
}

export async function toolFailure(error: unknown, context: ApiRouteContext, name: string) {
  let response: Response;
  if (error instanceof ApiHttpError) {
    response = problemResponse({ status: error.status, code: error.code, detail: error.message,
      errors: error.issues?.map((issue) => ({
        pointer: issue.path.length ? `/${issue.path.map((part) => String(part).replaceAll("~", "~0").replaceAll("/", "~1")).join("/")}` : "",
        code: issue.code, detail: issue.message,
      })), instance: context.instance, requestId: context.requestId });
  } else if (error instanceof DomainError) {
    if (error.cause !== undefined || error.code === "deadline_exceeded") logApiError(error, name, context.requestId);
    response = actionFailureResponse(toActionFailure(error, {
      fallbackMessage: "The request could not be completed.", log: { message: "MCP tool failed" }, logUnexpected: false,
    }), context.instance, context.requestId);
  } else {
    logApiError(error, name, context.requestId);
    throw new ProtocolError(ProtocolErrorCode.InternalError, "The request could not be completed.");
  }
  const problem: z.infer<typeof problemSchema> = await response.json();
  const structuredContent = toolErrorSchema.parse({ ...problem, issues: problem.errors });
  return { ...toolSuccess(structuredContent, problem.detail), isError: true };
}
