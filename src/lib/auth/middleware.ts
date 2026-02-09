/**
 * Authentication middleware
 * Handles session validation and route protection
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/better-auth";

/**
 * Route configuration
 */
const PUBLIC_ROUTES = [
  "/login",
  "/forgot-password",
  "/reset-password",
  "/set-password",
  "/verify-email",
  "/unauthorized",
  "/api/auth",
];

const AUTH_ROUTES = ["/login", "/forgot-password"];

/**
 * Check if path matches any of the given routes
 */
function matchesRoute(pathname: string, routes: string[]): boolean {
  return routes.some((route) => {
    if (route.endsWith("*")) {
      return pathname.startsWith(route.slice(0, -1));
    }
    return pathname === route || pathname.startsWith(`${route}/`);
  });
}

/**
 * Update session function
 * Called from src/proxy.ts (Next.js 16 proxy) for all requests
 */
export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Allow API auth routes to pass through
  if (pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  // Get session from Better Auth
  let session = null;
  try {
    session = await auth.api.getSession({
      headers: request.headers,
    });
  } catch {
    // Session retrieval failed
    session = null;
  }

  const isAuthenticated = !!session?.user;
  const isEmailVerified = session?.user?.emailVerified || false;
  const isPublicRoute = matchesRoute(pathname, PUBLIC_ROUTES);
  const isAuthRoute = matchesRoute(pathname, AUTH_ROUTES);
  const isApiRoute = pathname.startsWith("/api");

  // If authenticated and on an auth page, redirect to app
  if (isAuthenticated && isAuthRoute) {
    return NextResponse.redirect(new URL("/projects", request.url));
  }

  // If not authenticated and not on a public route
  if (!isAuthenticated && !isPublicRoute) {
    if (isApiRoute) {
      return new NextResponse(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // If authenticated but email not verified and trying to access protected routes
  if (
    isAuthenticated &&
    !isEmailVerified &&
    !isPublicRoute &&
    pathname !== "/verify-email"
  ) {
    if (isApiRoute) {
      return new NextResponse(
        JSON.stringify({ error: "Email verification required" }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
    return NextResponse.redirect(new URL("/verify-email", request.url));
  }

  return NextResponse.next();
}
