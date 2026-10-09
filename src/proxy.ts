/**
 * Next.js 16 middleware replacement using Node.js runtime
 * Handles authentication session management for all routes
 */

import { NextRequest } from "next/server";
import { updateSession } from "@/lib/auth/middleware";
import { guardApiMethod } from "@/lib/api/method-not-allowed";

/**
 * Proxy function for authentication middleware
 * This replaces the traditional middleware.ts in Next.js 16
 */
export default async function proxy(request: NextRequest) {
  const methodRefusal = await guardApiMethod(request);
  if (methodRefusal) return methodRefusal;
  return await updateSession(request);
}

export const config = {
  matcher: [
    // API identifiers may end in a file extension; they are still route parameters.
    "/api/v1/:path*",
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff|woff2|ttf|otf|eot)$).*)",
  ],
};
