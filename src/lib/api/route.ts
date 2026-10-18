import { getOAuthConfig } from "@/lib/auth/oauth-config";
import { OPERATION_DEADLINE_MS } from "@/config/operations";
import { randomUUID } from "node:crypto";
import { resolveApiContext, type ApiContext } from "@/lib/auth/api-context";
import { principalAllows, type ApiScope } from "@/lib/auth/api-scopes";
import { deadlineExceeded, DomainError } from "@/lib/domain-errors";
import { toActionFailure } from "@/fn/action-errors";
import { actionFailureResponse, apiDenialResponse, apiHttpErrorResponse, apiResponseHeaders, rateLimitHeaders } from "./problem";
import { logApiError, shouldLogDomainError, unexpectedApiErrorResponse } from "./route-error";
import { ApiHttpError } from "./http-error";
import { preAuthGuard, credentialAdmissionGuard, postAuthGuard } from "./guards";
import type { RateLimitResult } from "@/data-access/api-rate-limits";

export interface ApiRouteContext {
  ctx: ApiContext;
  deadlineAt: number;
  requestId: string;
  instance: string;
  headers: Headers;
}

/** Scope checks precede the write switch and operation buckets. */
async function admitApiRequest(
  access: "read" | "write", context: ApiRouteContext, scope: ApiScope | undefined, ipResult: RateLimitResult | null, writesDisabledInHandler?: boolean,
) {
  if (scope && !principalAllows(context.ctx, scope)) {
    return { ok: false as const, response: apiDenialResponse("missing_scope", context.instance, context.requestId, { role: context.ctx.orgRole, oauth: context.ctx.principal.kind === "oauth", scopes: context.ctx.scopes, requiredScopes: [scope] }) };
  }
  return postAuthGuard(context.ctx, {
    requestId: context.requestId, instance: context.instance,
    access, writesDisabledInHandler,
  }, ipResult);
}

interface ApiRouteOptions {
  audience: "rest" | "mcp";
  /** Named command exceptions may use a longer budget, including authentication. */
  deadlineMs?: number;
  /** Charge write buckets normally; the handler must enforce the write switch. */
  writesDisabledInHandler?: boolean;
  /** Runs once after authentication, after credential admission, before operation rate limiting; the handler receives the returned request. */
  prepare?: (request: Request, context: ApiRouteContext) => Promise<{ request: Request; access: "read" | "write"; response?: Response }>;
  /** MCP checks inside the tool so expiry is a structured tool result. */
  deadlineInHandler?: boolean;
}

export function apiRoute<Params = Record<string, never>>(
  op: string,
  scope: ApiScope | undefined,
  handler: (request: Request, context: ApiRouteContext, params: Params) => Promise<Response>,
  options: ApiRouteOptions,
) {
  return async (request: Request, route?: { params: Promise<Params> }): Promise<Response> => {
    const deadlineAt = Date.now() + (options.deadlineMs ?? OPERATION_DEADLINE_MS);
    const requestId = randomUUID();
    const instance = new URL(request.url).pathname;
    const headers = apiResponseHeaders(requestId);
    const finish = (response: Response) => {
      for (const [name, value] of headers) {
        if (name.startsWith("ratelimit-") && response.headers.has(name)) continue;
        response.headers.set(name, value);
      }
      return response;
    };
    try {
      const preAuth = await preAuthGuard(request, { instance, requestId });
      if (preAuth.response) return preAuth.response;
      if (preAuth.result) {
        for (const [name, value] of rateLimitHeaders(preAuth.result)) headers.set(name, value);
      }
      const audience = getOAuthConfig()[options.audience];
      const resolution = await resolveApiContext(request, audience);
      if (!resolution.ok) {
        return apiDenialResponse(resolution.denial, instance, requestId, { audience, oauth: /^Bearer\s+\S+/i.test(request.headers.get("authorization") ?? "") });
      }
      const admitted = await credentialAdmissionGuard(resolution.ctx, { instance, requestId });
      if (admitted.response) return admitted.response;
      const priorResult = [preAuth.result, admitted.result].filter((result): result is RateLimitResult => result !== null)
        .reduce<RateLimitResult | null>((tightest, result) => !tightest || result.remaining < tightest.remaining ? result : tightest, null);
      if (priorResult) rateLimitHeaders(priorResult).forEach((value, name) => headers.set(name, value));
      const context = { deadlineAt, ctx: resolution.ctx, requestId, instance, headers: new Headers(headers) };
      const prepared = options.prepare ? await options.prepare(request, context) : {
        request, access: request.method === "GET" || request.method === "HEAD" ? "read" as const : "write" as const,
      };
      if ("response" in prepared && prepared.response) return finish(prepared.response);
      const admission = await admitApiRequest(prepared.access, context, scope, priorResult, options.writesDisabledInHandler);
      if (!admission.ok) return finish(admission.response);
      for (const [name, value] of admission.headers) {
        headers.set(name, value);
        context.headers.set(name, value);
      }
      const params = route ? await route.params : {} as Params;
      if (!options.deadlineInHandler && Date.now() >= deadlineAt) throw deadlineExceeded("before starting");
      const response = await handler(prepared.request, context, params);
      return finish(response);
    } catch (error) {
      if (error instanceof ApiHttpError) {
        return finish(apiHttpErrorResponse(error, instance, requestId));
      }
      if (error instanceof DomainError) {
        // The action converter logs raw causes. REST logs only trusted classes
        // and codes, then uses the same conversion without its action logger.
        if (shouldLogDomainError(error)) {
          logApiError(error, op, requestId);
        }
        const failure = toActionFailure(error, {
          fallbackMessage: "The request could not be completed.", log: { message: "API request failed" },
          logUnexpected: false,
        });
        return finish(actionFailureResponse(failure, instance, requestId, error));
      }
      return finish(unexpectedApiErrorResponse(error, op, instance, requestId));
    }
  };
}
