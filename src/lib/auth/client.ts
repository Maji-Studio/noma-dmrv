/**
 * Client-side authentication utilities
 * For use in Client Components
 */
"use client";

import {
  signInWithPassword as providerSignIn,
  signOut as providerSignOut,
  resendVerificationEmail as providerResendVerification,
  getCurrentUserEmail as providerGetCurrentUserEmail,
  getSession as providerGetSession,
  requestPasswordReset as providerRequestPasswordReset,
  resetPassword as providerResetPassword,
  authClient,
} from "./providers/better-auth-client";

/**
 * Authentication hook for client components
 * Provides methods for authentication operations
 */
export function useAuth() {
  return {
    signIn: providerSignIn,
    signOut: providerSignOut,
    resendVerification: providerResendVerification,
    getCurrentUserEmail: providerGetCurrentUserEmail,
    getSession: providerGetSession,
    requestPasswordReset: providerRequestPasswordReset,
    resetPassword: providerResetPassword,
  };
}

// Export authClient for use with Better Auth React hooks
export { authClient };
