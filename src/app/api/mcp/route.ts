import { localhostAllowedOrigins, originValidationResponse } from "@modelcontextprotocol/server";
import { env } from "@/config/env";
import { readBoundedBody } from "@/lib/api/request-body";
import { ApiHttpError } from "@/lib/api/http-error";
import { apiRoute } from "@/lib/api/route";
import { mcpRequestAccess, serveMcp } from "@/lib/mcp/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const authenticatedHandler = apiRoute("api.mcp", undefined, serveMcp, {
  deadlineInHandler: true,
  prepare: async (request) => {
    const bytes = await readBoundedBody(request);
    // Malformed JSON is left to the SDK's protocol parser after admission.
    let body: unknown;
    try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { /* SDK owns parse errors. */ }
    if (Array.isArray(body)) {
      throw new ApiHttpError(400, "batch_not_supported", "Send one JSON-RPC message per request.");
    }
    return {
      request: new Request(request.url, {
        method: request.method, headers: request.headers, body: bytes, signal: request.signal,
      }),
      access: mcpRequestAccess(body),
    };
  },
});

export async function POST(request: Request): Promise<Response> {
  const hostnames = localhostAllowedOrigins();
  if (env.NEXT_PUBLIC_APP_URL) hostnames.push(new URL(env.NEXT_PUBLIC_APP_URL).hostname);
  const rejected = originValidationResponse(request, hostnames);
  return rejected ?? authenticatedHandler(request);
}

function methodNotAllowed(): Response {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
export { methodNotAllowed as GET, methodNotAllowed as DELETE };
