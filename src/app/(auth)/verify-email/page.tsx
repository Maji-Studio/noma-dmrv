/**
 * Email verification waiting page
 * Shows instructions to check email for verification link
 */
"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth/client";

export default function VerifyEmailPage() {
  // Get email from sessionStorage on mount (set during set-password flow)
  const [email] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      return sessionStorage.getItem("pendingVerificationEmail");
    }
    return null;
  });

  const [resending, setResending] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);
  const [error, setError] = useState("");

  const { resendVerification } = useAuth();

  async function handleResendVerification() {
    if (!email) return;

    setResending(true);
    setResendSuccess(false);
    setError("");

    const result = await resendVerification(email);

    if (result.success) {
      setResendSuccess(true);
    } else {
      setError(result.error || "Failed to resend verification email");
    }

    setResending(false);
  }

  return (
    <div className="w-full max-w-[400px] mx-auto">
      <div className="mb-32 text-center">
        <div className="w-16 h-16 mx-auto mb-m bg-[var(--clr-dark-purple-10)] rounded-full flex items-center justify-center">
          <svg
            className="w-8 h-8 text-[var(--clr-dark-purple)]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
            />
          </svg>
        </div>

        <h1 className="title-heading-2 mb-32">Check your email</h1>
        <p className="body-medium text-[var(--color-text-secondary)]">
          We&apos;ve sent a verification link to{" "}
          {email ? (
            <span className="font-semibold">{email}</span>
          ) : (
            <span className="font-semibold">your email</span>
          )}
        </p>
      </div>

      <div className="bg-[var(--color-background-white)] rounded-[var(--radius-8)] border border-[var(--color-border-primary)] p-32 space-y-24 shadow-sm">
        <div className="space-y-16">
          <p className="body-small text-[var(--color-text-secondary)]">
            Please check your inbox and click the verification link to activate
            your account.
          </p>
          <p className="body-small text-[var(--color-text-tertiary)]">
            Don&apos;t forget to check your spam folder if you don&apos;t see
            the email.
          </p>
        </div>

        {resendSuccess && (
          <div
            className="p-s bg-green-50 border border-green-500 rounded-none text-green-700 body-small"
            role="status"
            aria-live="polite"
          >
            Verification email sent! Please check your inbox.
          </div>
        )}

        {error && (
          <div
            className="p-s bg-[var(--color-signal-red)]/10 border border-[var(--color-signal-red)] rounded-none text-[var(--color-signal-red)] body-small"
            role="alert"
            aria-live="polite"
          >
            {error}
          </div>
        )}

        <div className="pt-s border-t border-[var(--color-border-tertiary)]">
          <p className="body-small text-[var(--color-text-secondary)] mb-xs">
            Didn&apos;t receive the email?
          </p>
          <button
            type="button"
            onClick={handleResendVerification}
            disabled={resending || !email}
            className="body-small text-[var(--clr-dark-purple)] hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {resending ? "Sending..." : "Resend verification email"}
          </button>
        </div>

        <div className="text-center pt-s">
          <Link
            href="/login"
            className="body-small text-[var(--color-text-tertiary)] hover:text-[var(--clr-dark-purple)]"
          >
            Back to login
          </Link>
        </div>
      </div>
    </div>
  );
}
