/**
 * Better Auth server provider
 * Wraps Better Auth server methods for provider-agnostic abstraction
 */
import { headers } from "next/headers";
import { auth } from "@/lib/auth/better-auth";
import type { AuthResult, AuthUser } from "./better-auth-client";

/**
 * Get Better Auth session from request headers
 */
export async function getBetterAuthSession() {
  const headersList = await headers();

  try {
    const session = await auth.api.getSession({
      headers: headersList,
    });

    return session;
  } catch {
    return null;
  }
}

/**
 * Map Better Auth user to AuthUser type
 */
export function mapBetterAuthUser(user: {
  id: string;
  email: string;
  name?: string | null;
  role?: string;
  emailVerified?: boolean;
  createdAt: string | Date;
  updatedAt: string | Date;
}): AuthUser {
  // Normalize role to ensure it's either "admin" or "user"
  const normalizedRole: "admin" | "user" =
    user.role === "admin" ? "admin" : "user";

  return {
    id: user.id,
    email: user.email,
    name: user.name || null,
    role: normalizedRole,
    emailVerified: user.emailVerified || false,
    createdAt: new Date(user.createdAt),
    updatedAt: new Date(user.updatedAt),
  };
}

/**
 * Sign out current user (server-side)
 */
export async function signOut(): Promise<AuthResult> {
  const headersList = await headers();

  try {
    await auth.api.signOut({
      headers: headersList,
    });

    return { success: true };
  } catch (error) {
    if (error instanceof Error) {
      return {
        success: false,
        error: error.message,
      };
    }

    return {
      success: false,
      error: "Failed to sign out.",
    };
  }
}

/**
 * Create user with email and password (server-side only)
 * Used for admin invite flow
 */
export async function signUpWithPassword(
  email: string,
  password: string,
  name?: string
): Promise<AuthResult<{ userId: string }>> {
  try {
    const result = await auth.api.signUpEmail({
      body: {
        email,
        password,
        name: name || email.split("@")[0],
      },
    });

    if (!result) {
      return {
        success: false,
        error: "Failed to create user account.",
      };
    }

    return {
      success: true,
      data: {
        userId: result.user.id,
      },
    };
  } catch (error) {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();

      if (message.includes("already exists") || message.includes("duplicate")) {
        return {
          success: false,
          error: "An account with this email already exists.",
        };
      }

      return {
        success: false,
        error: error.message,
      };
    }

    return {
      success: false,
      error: "An unexpected error occurred while creating the account.",
    };
  }
}
