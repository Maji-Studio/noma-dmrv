/**
 * Next.js 16 Proxy (replaces middleware)
 * Handles authentication and route protection with Node.js runtime
 */
import { updateSession } from "@/lib/auth/middleware";
import { NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for:
     * - _next (Next.js internals)
     * - api/ (API routes handled separately)
     * - favicon.ico
     * - Static image files (svg, png, jpg, jpeg, gif, webp)
     */
    "/((?!_next|api/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
