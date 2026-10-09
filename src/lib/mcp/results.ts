import { z } from "zod";
import { toToolSchema } from "@/lib/operations/mcp-schema";
import { ProtocolError, ProtocolErrorCode } from "@modelcontextprotocol/server";
import { problemSchema } from "@/lib/api/problem-schema";
import { actionFailureResponse, apiHttpErrorResponse } from "@/lib/api/problem";
import { ApiHttpError } from "@/lib/api/http-error";
import { logApiError, shouldLogDomainError } from "@/lib/api/route-error";
import type { ApiRouteContext } from "@/lib/api/route";
import { DomainError } from "@/lib/domain-errors";
import { toActionFailure } from "@/fn/action-errors";

/** REST's `errors` become MCP `issues`; HTTP metadata does not cross transports. */
export const toolErrorSchema = problemSchema.pick({ code: true, detail: true, retryable: true, conflict: true, blockers: true, current: true })
  .extend({ issues: problemSchema.shape.errors });

export function toolSuccess(structuredContent: Record<string, unknown>, text: string) {
  return { content: [{ type: "text" as const, text }], structuredContent };
}

export function writesDisabledResult() {
  const structuredContent = toolErrorSchema.parse({
    code: "api_writes_disabled", detail: "API writes are temporarily disabled.", retryable: true, issues: [],
  });
  return { ...toolSuccess(structuredContent, structuredContent.detail), isError: true };
}

export async function toolFailure(error: unknown, context: ApiRouteContext, name: string) {
  let response: Response;
  if (error instanceof ApiHttpError) {
    response = apiHttpErrorResponse(error, context.instance, context.requestId);
  } else if (error instanceof DomainError) {
    if (shouldLogDomainError(error)) logApiError(error, name, context.requestId);
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


/** Legacy MCP clients require an object root for the success/error union. */
export function toolOutputSchema(output: z.ZodType) {
  const union = toToolSchema(z.union([output, toolErrorSchema]));
  const converters = union["~standard"].jsonSchema;
  return {
    "~standard": {
      ...union["~standard"],
      jsonSchema: {
        input: (options: Parameters<typeof converters.input>[0]) => ({ ...converters.input(options), type: "object" as const }),
        output: (options: Parameters<typeof converters.output>[0]) => ({ ...converters.output(options), type: "object" as const }),
      },
    },
  };
}
