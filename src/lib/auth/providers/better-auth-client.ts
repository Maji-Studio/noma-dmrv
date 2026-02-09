/**
 * Better Auth client provider
 * Wraps Better Auth client methods for provider-agnostic abstraction
 */
"use client";

import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3100",
});

export interface AuthResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  role: "user" | "admin";
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthSession {
  user: AuthUser;
  session: {
    id: string;
    userId: string;
    expiresAt: Date;
  };
}

/**
 * Map Better Auth errors to user-friendly messages
 */
function mapBetterAuthError(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    if (message.includes("email not verified")) {
      return "Please verify your email before signing in.";
    }
    if (message.includes("invalid credentials") || message.includes("invalid email or password")) {
      return "Invalid email or password.";
    }
    if (message.includes("user not found")) {
      return "No account found with this email.";
    }
    if (message.includes("too many requests")) {
      return "Too many attempts. Please try again later.";
    }
    if (message.includes("token expired")) {
      return "This link has expired. Please request a new one.";
    }
    if (message.includes("invalid token")) {
      return "Invalid or expired link.";
    }

    return error.message;
  }

  return "An unexpected error occurred. Please try again.";
}

/**
 * Sign in with email and password
 */
export async function signInWithPassword(
  email: string,
  password: string
): Promise<AuthResult<AuthSession>> {
  try {
    const result = await authClient.signIn.email({
      email,
      password,
    });

    if (!result.data) {
      return {
        success: false,
        error: "Failed to sign in. Please try again.",
      };
    }

    // Check if email is verified
    if (!result.data.user.emailVerified) {
      return {
        success: false,
        error: "Please verify your email before signing in.",
      };
    }

    // Type assertions needed because Better Auth doesn't know about custom schema fields
    const data = result.data as typeof result.data & {
      user: typeof result.data.user & { role?: string };
      session?: {
        id: string;
        userId: string;
        expiresAt: Date;
      };
    };

    // Verify session data exists
    if (!data.session?.id || !data.session?.userId) {
      return {
        success: false,
        error: "Failed to create session. Please try again.",
      };
    }

    // Normalize role to ensure it's either "admin" or "user"
    const normalizedRole: "admin" | "user" =
      data.user.role === "admin" ? "admin" : "user";

    return {
      success: true,
      data: {
        user: {
          id: data.user.id,
          email: data.user.email,
          name: data.user.name,
          role: normalizedRole,
          emailVerified: data.user.emailVerified,
          createdAt: new Date(data.user.createdAt),
          updatedAt: new Date(data.user.updatedAt),
        },
        session: {
          id: data.session.id,
          userId: data.session.userId,
          expiresAt: data.session.expiresAt
            ? new Date(data.session.expiresAt)
            : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      },
    };
  } catch (error) {
    return {
      success: false,
      error: mapBetterAuthError(error),
    };
  }
}

/**
 * Sign out current user
 */
export async function signOut(): Promise<AuthResult> {
  try {
    await authClient.signOut();
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: mapBetterAuthError(error),
    };
  }
}

/**
 * Resend email verification
 */
export async function resendVerificationEmail(
  email: string
): Promise<AuthResult> {
  try {
    await authClient.sendVerificationEmail({ email });
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: mapBetterAuthError(error),
    };
  }
}

/**
 * Get current user email from session
 */
export async function getCurrentUserEmail(): Promise<string | null> {
  try {
    const session = await authClient.getSession();
    return session.data?.user?.email || null;
  } catch {
    return null;
  }
}

/**
 * Get current session with user
 */
export async function getSession(): Promise<AuthSession | null> {
  try {
    const session = await authClient.getSession();

    if (!session.data?.user) {
      return null;
    }

    // Type assertion needed because Better Auth doesn't know about custom role field
    const user = session.data.user as typeof session.data.user & {
      role?: string;
    };

    // Normalize role to ensure it's either "admin" or "user"
    const normalizedRole: "admin" | "user" =
      user.role === "admin" ? "admin" : "user";

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: normalizedRole,
        emailVerified: user.emailVerified,
        createdAt: new Date(user.createdAt),
        updatedAt: new Date(user.updatedAt),
      },
      session: {
        id: session.data.session.id,
        userId: session.data.session.userId,
        expiresAt: new Date(session.data.session.expiresAt),
      },
    };
  } catch {
    return null;
  }
}

/**
 * Request password reset
 */
export async function requestPasswordReset(
  email: string
): Promise<AuthResult> {
  try {
    // Better Auth handles password reset through the server configuration
    // We make a direct API call to the forget-password endpoint
    const baseURL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3100";

    // Create AbortController with timeout to prevent hanging requests
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    try {
      const response = await fetch(`${baseURL}/api/auth/forget-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          redirectTo: "/reset-password",
        }),
        credentials: "same-origin",
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error("Failed to send password reset email");
      }

      return { success: true };
    } catch (fetchError) {
      clearTimeout(timeoutId);
      throw fetchError;
    }
  } catch (error) {
    return {
      success: false,
      error: mapBetterAuthError(error),
    };
  }
}

/**
 * Reset password with token
 */
export async function resetPassword(
  token: string,
  newPassword: string
): Promise<AuthResult> {
  try {
    await authClient.resetPassword({
      newPassword,
      token,
    });
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: mapBetterAuthError(error),
    };
  }
}
