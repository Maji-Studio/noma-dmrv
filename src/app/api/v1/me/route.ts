import { preAuthGuard, postAuthGuard } from "@/lib/api/guards";
import { randomUUID } from "node:crypto";
import { resolveApiContext } from "@/lib/auth/api-context";
import { apiDenialResponse, apiResponseHeaders } from "@/lib/api/problem";
import { unexpectedApiErrorResponse } from "@/lib/api/route-error";
import { readApiMe } from "@/lib/read-models/api-me";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestId = randomUUID();
  const instance = new URL(request.url).pathname;
  try {
    const preAuth = await preAuthGuard(request, { requestId, instance });
    if (preAuth) return preAuth;
    const resolution = await resolveApiContext(request);
    if (!resolution.ok) return apiDenialResponse(resolution.denial, instance, requestId);
    const guarded = await postAuthGuard(resolution.ctx, { access: "read", requestId, instance });
    if (!guarded.ok) return guarded.response;
    const headers = apiResponseHeaders(requestId);
    guarded.headers.forEach((value, key) => headers.set(key, value));
    return Response.json({ data: await readApiMe(resolution.ctx) }, { headers });
  } catch (error) {
    return unexpectedApiErrorResponse(error, "api.v1.me", instance, requestId);
  }
}
