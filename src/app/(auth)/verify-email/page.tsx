/**
 * Email verification waiting page
 * Shows instructions to check email for verification link
 */
"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";

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
      setError(
        result.error ||
          "The verification email was not sent. Check your connection and try again.",
      );
    }

    setResending(false);
  }

  return (
    <div className="w-full max-w-[400px] mx-auto">
      <div className="mb-32 text-center">
        <div className="w-64 h-64 mx-auto mb-24 bg-[var(--clr-dark-purple-10)] rounded-full flex items-center justify-center">
          <svg
            className="w-32 h-32 text-[var(--clr-dark-purple)]"
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
            <span className="body-bold">{email}</span>
          ) : (
            <span className="body-bold">your email</span>
          )}
        </p>
      </div>

      <div className="bg-[var(--color-background-white)] rounded-none border border-[var(--color-border-primary)] p-32 space-y-24 shadow-sm">
        <div className="space-y-16">
          <p className="body-small text-[var(--color-text-secondary)]">
            Check your inbox and use the verification link to activate your
            account.
          </p>
          <p className="body-small text-[var(--color-text-tertiary)]">
            Don&apos;t forget to check your spam folder if you don&apos;t see
            the email.
          </p>
        </div>

        {resendSuccess && (
          <Notice tone="success">Verification email sent. Check your inbox.</Notice>
        )}

        {error && (
          <Notice tone="error">{error}</Notice>
        )}

        <div className="pt-16 border-t border-[var(--color-border-tertiary)]">
          <p className="body-small text-[var(--color-text-secondary)] mb-16">
            Didn&apos;t receive the email?
          </p>
          <Button
            type="button"
            variant="noOutline"
            size="small"
            onClick={handleResendVerification}
            disabled={!email}
            busy={resending}
          >
            Resend verification email
          </Button>
        </div>

        <div className="text-center pt-16">
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
