/**
 * Server-side authentication utilities
 * For use in Server Components and Server Actions
 */
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { members, users } from "@/db/schema";
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

  if (!session?.user?.id) {
    return null;
  }

  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      emailVerified: users.emailVerified,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  if (!user) {
    return null;
  }

  return mapBetterAuthUser(user);
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

// ---------------------------------------------------------------------------
// Organization context (multi-tenancy — Better Auth organization plugin)
// ---------------------------------------------------------------------------

export type OrgRole = "owner" | "admin" | "member";

/**
 * The org-scoped request context threaded through org-aware server actions.
 * `orgRole` is null for a Platform Admin operating inside an org they are not a
 * member of (their authority comes from `isPlatformAdmin`, per CONTEXT.md).
 */
export type OrgContext = {
  userId: string;
  organizationId: string;
  orgRole: OrgRole | null;
  isPlatformAdmin: boolean;
};

const ORG_ROLE_RANK: Record<OrgRole, number> = {
  member: 1,
  admin: 2,
  owner: 3,
};

/**
 * Resolve the active-organization context for the current session, or null if
 * the user is signed out or has no active organization selected. Platform
 * Admins pass without a membership row (override).
 */
export async function getOrgContext(): Promise<OrgContext | null> {
  const session = await getBetterAuthSession();
  const userId = session?.user?.id;
  if (!userId) {
    return null;
  }

  const activeOrganizationId =
    (session.session as { activeOrganizationId?: string | null })
      .activeOrganizationId ?? null;
  if (!activeOrganizationId) {
    return null;
  }

  const [userRow] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const isPlatformAdmin = userRow?.role === "admin";

  const [membership] = await db
    .select({ role: members.role })
    .from(members)
    .where(
      and(
        eq(members.userId, userId),
        eq(members.organizationId, activeOrganizationId)
      )
    )
    .limit(1);

  // Active org is set but the user is neither a member nor a Platform Admin:
  // treat as no context (the org switcher / chooser should re-resolve it).
  if (!membership && !isPlatformAdmin) {
    return null;
  }

  return {
    userId,
    organizationId: activeOrganizationId,
    orgRole: (membership?.role as OrgRole | undefined) ?? null,
    isPlatformAdmin,
  };
}

/**
 * Require an active-organization context inside a server action. Throws
 * SafeError (never redirects) so `withAction`'s try/catch surfaces it as a
 * clean ActionResult error instead of swallowing a redirect signal.
 */
export async function requireOrgContext(): Promise<OrgContext> {
  const ctx = await getOrgContext();
  if (!ctx) {
    throw new SafeError("Select an Organization to continue.");
  }
  return ctx;
}

/**
 * Assert the context holds at least `minRole` in the active org. Owner ⊃ Admin
 * ⊃ Member; Platform Admins always pass. Throws SafeError otherwise.
 */
export function requireOrgRole(ctx: OrgContext, minRole: OrgRole): void {
  if (ctx.isPlatformAdmin) {
    return;
  }
  if (!ctx.orgRole || ORG_ROLE_RANK[ctx.orgRole] < ORG_ROLE_RANK[minRole]) {
    throw new SafeError("You don't have permission to perform this action.");
  }
}

/**
 * Require the caller to be a Platform Admin (global `admin` role) inside a
 * server action. Throws SafeError. Used for organization lifecycle
 * (create/enter-any-org) and other cross-org tools.
 */
export async function requirePlatformAdmin(): Promise<AuthUser> {
  return requireAdminAction();
}
