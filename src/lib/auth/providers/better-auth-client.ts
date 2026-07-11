/**
 * Better Auth client provider
 * Wraps Better Auth client methods for provider-agnostic abstraction
 */
"use client";

import { createAuthClient } from "better-auth/react";
import { organizationClient } from "better-auth/client/plugins";

/** Abort the password-reset request if it hangs longer than this (ms). */
const PASSWORD_RESET_TIMEOUT_MS = 10000;
/** Path the reset-password email link should redirect the user back to. */
const PASSWORD_RESET_REDIRECT_PATH = "/reset-password";

/**
 * Resolve the origin auth requests should target.
 *
 * In the browser we always use the current origin so requests stay
 * same-origin no matter which domain served the page (e.g.
 * staging.noma.maji.studio vs the noma-dmrv-git-*.vercel.app branch URL).
 * Targeting NEXT_PUBLIC_APP_URL directly caused cross-origin requests and
 * CORS preflight failures when the served domain differed from that value.
 * On the server (SSR) we fall back to the configured app URL.
 */
function resolveAuthBaseURL(): string {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3100";
}

export const authClient = createAuthClient({
  baseURL: resolveAuthBaseURL(),
  plugins: [organizationClient()],
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
function getErrorMessage(error: unknown): string | null {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "object" && error !== null && "message" in error) {
    const message = error.message;
    if (typeof message === "string" && message.trim().length > 0) {
      return message;
    }
  }

  return null;
}

function mapBetterAuthError(error: unknown): string {
  const rawMessage = getErrorMessage(error);

  if (rawMessage) {
    const message = rawMessage.toLowerCase();

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

    return rawMessage;
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

    if (result.error) {
      return {
        success: false,
        error: mapBetterAuthError(result.error),
      };
    }

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
      token?: string;
      session?: {
        id: string;
        userId: string;
        expiresAt: Date;
      };
    };

    // Normalize role to ensure it's either "admin" or "user"
    const normalizedRole: "admin" | "user" =
      data.user.role === "admin" ? "admin" : "user";

    // Validate that we have a valid session from the server
    const sessionId = data.session?.id || data.token;
    if (!sessionId) {
      return {
        success: false,
        error: "Authentication succeeded but no session was created. Please try again.",
      };
    }

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
          id: sessionId,
          userId: data.session?.userId || data.user.id,
          expiresAt: data.session?.expiresAt
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
    // We make a direct API call to the request-password-reset endpoint.
    // Use the same origin that served the page (see resolveAuthBaseURL) so
    // the request stays same-origin and avoids CORS preflight failures.
    const baseURL = resolveAuthBaseURL();

    // Create AbortController with timeout to prevent hanging requests
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      PASSWORD_RESET_TIMEOUT_MS
    );

    try {
      const response = await fetch(`${baseURL}/api/auth/request-password-reset`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          redirectTo: PASSWORD_RESET_REDIRECT_PATH,
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
