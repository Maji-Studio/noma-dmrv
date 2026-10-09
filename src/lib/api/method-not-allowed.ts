import { randomUUID } from "node:crypto";
import { hasRoleAndScope } from "@/lib/auth/api-scopes";
import { ApiHttpError } from "./http-error";
import { getApiMethodEntry, isV1ApiPath, type ApiMethodEntry } from "./method-table";
import { problemResponse } from "./problem";
import { apiRoute } from "./route";

const METHOD_NOT_ALLOWED_STATUS = 405;
const NOT_FOUND_STATUS = 404;
const NOT_FOUND_DETAIL = "The requested API resource was not found.";

export function methodNotAllowedResponse(entry: ApiMethodEntry, instance: string, requestId: string): Response {
  const response = problemResponse({
    status: METHOD_NOT_ALLOWED_STATUS, code: "method_not_allowed",
    detail: "This method is not supported. Use a method listed in the Allow header.", instance, requestId,
  });
  response.headers.set("Allow", entry.methods.join(", "));
  return response;
}

/** Null leaves supported methods and non-v1 requests with their existing handlers. */
export async function guardApiMethod(request: Request): Promise<Response | null> {
  const instance = new URL(request.url).pathname;
  if (!isV1ApiPath(instance)) return null;
  const entry = getApiMethodEntry(instance);
  if (entry?.methods.includes(request.method)) return null;
  if (entry?.public) return methodNotAllowedResponse(entry, instance, randomUUID());

  return apiRoute("api.v1.method-not-allowed", undefined, async (_request, context) =>
    methodNotAllowedResponse(entry!, context.instance, context.requestId), {
    prepare: async (received, { ctx }) => {
      // Unknown and invisible paths have the same authenticated refusal, with no Allow.
      if (!entry || !entry.scopes.some((scope) => scope === null || hasRoleAndScope(ctx, scope))) {
        throw new ApiHttpError(NOT_FOUND_STATUS, "not_found", NOT_FOUND_DETAIL);
      }
      // Refusing a method performs no write and must not trigger the write kill switch.
      return { request: received, access: "read" };
    },
  })(request);
}
