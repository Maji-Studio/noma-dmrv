import { OPERATION_DEADLINE_MS } from "@/config/operations";
import { randomUUID } from "node:crypto";
import { resolveApiContext, type ApiContext } from "@/lib/auth/api-context";
import { hasRoleAndScope, type ApiScope } from "@/lib/auth/api-scopes";
import { DomainError } from "@/lib/domain-errors";
import { toActionFailure } from "@/fn/action-errors";
import { actionFailureResponse, apiDenialResponse, apiResponseHeaders, problemResponse } from "./problem";
import { unexpectedApiErrorResponse } from "./route-error";
import { ApiHttpError } from "./http-error";
import { preAuthGuard, postAuthGuard } from "./guards";
import type { RateLimitResult } from "@/data-access/api-rate-limits";

export interface ApiRouteContext {
  ctx: ApiContext;
  deadlineAt: number;
  requestId: string;
  instance: string;
  headers: Headers;
}

/** Scope checks precede the authenticated write switch and rate limits. */
async function admitApiRequest(
  request: Request, context: ApiRouteContext, scope: ApiScope | undefined, ipResult: RateLimitResult | null,
) {
  if (scope && !hasRoleAndScope(context.ctx, scope)) {
    return { ok: false as const, response: apiDenialResponse("missing_scope", context.instance, context.requestId) };
  }
  return postAuthGuard(context.ctx, {
    requestId: context.requestId, instance: context.instance,
    access: request.method === "GET" || request.method === "HEAD" ? "read" : "write",
  }, ipResult);
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
    const headers = apiResponseHeaders(requestId);
    const finish = (response: Response) => {
      for (const [name, value] of headers) response.headers.set(name, value);
      return response;
    };
    try {
      const preAuth = await preAuthGuard(request, { instance, requestId });
      if (preAuth.response) return preAuth.response;
      const resolution = await resolveApiContext(request);
      if (!resolution.ok) return apiDenialResponse(resolution.denial, instance, requestId);
      const context = { deadlineAt, ctx: resolution.ctx, requestId, instance, headers: apiResponseHeaders(requestId) };
      const admission = await admitApiRequest(request, context, scope, preAuth.result);
      if (!admission.ok) return admission.response;
      for (const [name, value] of admission.headers) {
        headers.set(name, value);
        context.headers.set(name, value);
      }
      const response = await handler(request, context, route ? await route.params : {} as Params);
      return finish(response);
    } catch (error) {
      if (error instanceof ApiHttpError) {
        return finish(problemResponse({ status: error.status, code: error.code, detail: error.message, current: error.current, instance, requestId }));
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
        return finish(actionFailureResponse(failure, instance, requestId));
      }
      return finish(unexpectedApiErrorResponse(error, op, instance, requestId));
    }
  };
}
