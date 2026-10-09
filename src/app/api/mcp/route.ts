import { localhostAllowedOrigins, originValidationResponse } from "@modelcontextprotocol/server";
import { env } from "@/config/env";
import { apiRoute } from "@/lib/api/route";
import { mcpRequestAccess, serveMcp } from "@/lib/mcp/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const authenticatedHandler = apiRoute("api.mcp", undefined, serveMcp, {
  deadlineInHandler: true,
  access: async (request) => {
    // Malformed JSON is left to the SDK's protocol parser after admission.
    const body: unknown = await request.clone().json().catch(() => undefined);
    return mcpRequestAccess(body);
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
