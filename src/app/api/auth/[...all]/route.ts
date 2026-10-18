/**
 * Better Auth API routes
 * Handles all authentication endpoints
 */
import { auth } from "@/lib/auth/better-auth";
import { toNextJsHandler } from "better-auth/next-js";

export const { GET, POST } = toNextJsHandler(auth);

// Next.js reads route segment config statically, so this must be a literal.
// It must equal OAUTH_TOKEN_DEADLINE_SECONDS (a test pins the two): the refresh
// replay windows rely on this deadline (oauth spec 3.5).
export const maxDuration = 30;
