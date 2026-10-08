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
    const resolution = await resolveApiContext(request);
    if (!resolution.ok) return apiDenialResponse(resolution.denial, instance, requestId);
    return Response.json({ data: await readApiMe(resolution.ctx) }, { headers: apiResponseHeaders(requestId) });
  } catch (error) {
    return unexpectedApiErrorResponse(error, "api.v1.me", instance, requestId);
  }
}
