/**
 * Better Auth API routes
 * Handles all authentication endpoints
 */
import { auth } from "@/lib/auth/better-auth";
import { toNextJsHandler } from "better-auth/next-js";
import { randomUUID } from "node:crypto";
import { preAuthGuard } from "@/lib/api/guards";

const handlers = toNextJsHandler(auth);

function withOAuthEndpointLimit(handler: (request: Request) => Promise<Response>) {
  return async (request: Request) => {
    const path = new URL(request.url).pathname;
    // Only HTTP entry pays. Consent's internal authorize dispatch never comes
    // back through this route, so it cannot debit the shared IP bucket twice.
    if (path.startsWith("/api/auth/oauth2/")) {
      const { response } = await preAuthGuard(request, { requestId: randomUUID(), instance: path }, "oauth");
      if (response) return response;
    }
    return handler(request);
  };
}

export const GET = withOAuthEndpointLimit(handlers.GET);
export const POST = withOAuthEndpointLimit(handlers.POST);

// Next.js reads route segment config statically, so this must be a literal.
// It must equal OAUTH_TOKEN_DEADLINE_SECONDS (a test pins the two): the refresh
// replay windows rely on this deadline (oauth spec 3.5).
export const maxDuration = 30;
