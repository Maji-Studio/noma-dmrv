/**
 * Server-side authentication utilities
 * For use in Server Components and Server Actions
 */
import { redirect } from "next/navigation";
import { SafeError } from "@/lib/errors";
import {
  getBetterAuthSession,
  mapBetterAuthUser,
  signOut as providerSignOut,
} from "./providers/better-auth-server";
import type { AuthUser } from "./providers/better-auth-client";

/**
 * Get the current user from server context
 * Returns null if not authenticated
 */
export async function getUser(): Promise<AuthUser | null> {
  const session = await getBetterAuthSession();

  if (!session?.user) {
    return null;
  }

  return mapBetterAuthUser(session.user);
}

/**
 * Require authentication, redirect to login if not authenticated
 * Use this in page components and layouts
 */
export async function requireAuth(): Promise<AuthUser> {
  const user = await getUser();

  if (!user) {
    redirect("/login");
  }

  return user;
}

/**
 * Require verified email, redirect to verify-email if not verified
 * Use this for routes that require email verification
 */
export async function requireVerifiedAuth(): Promise<AuthUser> {
  const user = await requireAuth();

  if (!user.emailVerified) {
    redirect("/verify-email");
  }

  return user;
}

/**
 * Require admin role, redirect to unauthorized page if not admin
 */
export async function requireAdmin(): Promise<AuthUser> {
  const user = await requireVerifiedAuth();

  if (user.role !== "admin") {
    redirect("/unauthorized");
  }

  return user;
}

/**
 * Require admin role inside a server action. Throws SafeError instead of
 * redirecting — redirect() throws a control-flow signal that an action's
 * try/catch wrapper would swallow, silently letting non-admins through.
 */
export async function requireAdminAction(): Promise<AuthUser> {
  const user = await getUser();
  if (!user) {
    throw new SafeError("You must be signed in.");
  }
  if (!user.emailVerified) {
    throw new SafeError("Verify your email before performing this action.");
  }
  if (user.role !== "admin") {
    throw new SafeError("Admin access is required for this action.");
  }
  return user;
}

/**
 * Check if user is admin
 */
export async function isAdmin(): Promise<boolean> {
  const user = await getUser();
  return user?.role === "admin";
}

/**
 * Sign out the current user
 * Use this in route handlers or server actions
 */
export async function signOut() {
  return await providerSignOut();
}
