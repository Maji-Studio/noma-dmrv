import { OPERATION_DEADLINE_MS } from "@/config/operations";
import { randomUUID } from "node:crypto";
import { resolveApiContext, type ApiContext } from "@/lib/auth/api-context";
import { hasRoleAndScope, type ApiScope } from "@/lib/auth/api-scopes";
import { DomainError } from "@/lib/domain-errors";
import { toActionFailure } from "@/fn/action-errors";
import { actionFailureResponse, apiDenialResponse, apiResponseHeaders, problemResponse } from "./problem";
import { unexpectedApiErrorResponse } from "./route-error";
import { ApiHttpError } from "./http-error";

export interface ApiRouteContext {
  ctx: ApiContext;
  deadlineAt: number;
  requestId: string;
  instance: string;
  headers: Headers;
}

/** Authenticated admission boundary; request guards attach here after the rebase. */
async function admitApiRequest(context: ApiRouteContext, scope?: ApiScope): Promise<Response | undefined> {
  if (scope && !hasRoleAndScope(context.ctx, scope)) {
    return apiDenialResponse("missing_scope", context.instance, context.requestId);
  }
}

export function apiRoute<Params = Record<string, never>>(
  op: string,
  scope: ApiScope | undefined,
  handler: (request: Request, context: ApiRouteContext, params: Params) => Promise<Response>,
) {
  return async (request: Request, route?: { params: Promise<Params> }): Promise<Response> => {
    const deadlineAt = Date.now() + OPERATION_DEADLINE_MS;
    const requestId = randomUUID();
    const instance = new URL(request.url).pathname;
    try {
      const resolution = await resolveApiContext(request);
      if (!resolution.ok) return apiDenialResponse(resolution.denial, instance, requestId);
      const context = { deadlineAt, ctx: resolution.ctx, requestId, instance, headers: apiResponseHeaders(requestId) };
      const denied = await admitApiRequest(context, scope);
      if (denied) return denied;
      const response = await handler(request, context, route ? await route.params : {} as Params);
      for (const [name, value] of apiResponseHeaders(requestId)) response.headers.set(name, value);
      return response;
    } catch (error) {
      if (error instanceof ApiHttpError) {
        return problemResponse({ status: error.status, code: error.code, detail: error.message, current: error.current, instance, requestId });
      }
      if (error instanceof DomainError) {
        // The action converter logs raw causes. REST logs only trusted classes
        // and codes, then uses the same conversion without its action logger.
        if (error.cause !== undefined || error.code === "outcome_unknown" || error.code === "deadline_exceeded") {
          unexpectedApiErrorResponse(error, op, instance, requestId);
        }
        const failure = toActionFailure(error, {
          fallbackMessage: "The request could not be completed.", log: { message: "API request failed" },
          logUnexpected: false,
        });
        return actionFailureResponse(failure, instance, requestId);
      }
      return unexpectedApiErrorResponse(error, op, instance, requestId);
    }
  };
}
