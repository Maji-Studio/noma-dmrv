/**
 * Next.js 16 middleware replacement using Node.js runtime
 * Handles authentication session management for all routes
 */

import { NextRequest } from "next/server";
import { updateSession } from "@/lib/auth/middleware";

/**
 * Proxy function for authentication middleware
 * This replaces the traditional middleware.ts in Next.js 16
 */
export default async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff|woff2|ttf|otf|eot)$).*)",
  ],
};
