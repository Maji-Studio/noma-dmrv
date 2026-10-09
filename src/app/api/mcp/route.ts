import { localhostAllowedOrigins, originValidationResponse } from "@modelcontextprotocol/server";
import { env } from "@/config/env";
import { readBoundedBody } from "@/lib/api/request-body";
import { apiRoute } from "@/lib/api/route";
import { mcpRequestAccess, serveMcp } from "@/lib/mcp/server";

export const runtime = "nodejs";
export const maxDuration = 30;

function authenticatedHandler(request: Request): Promise<Response> {
  let preparedRequest = request;
  return apiRoute("api.mcp", undefined, (_request, context) => serveMcp(preparedRequest, context), {
    deadlineInHandler: true,
    access: async () => {
      const bytes = await readBoundedBody(request);
      preparedRequest = new Request(request.url, {
        method: request.method, headers: request.headers, body: bytes, signal: request.signal,
      });
      // Malformed JSON is left to the SDK's protocol parser after admission.
      let body: unknown;
      try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { /* SDK owns parse errors. */ }
      return mcpRequestAccess(body);
    },
  })(request);
}

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
