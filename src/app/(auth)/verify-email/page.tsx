/**
 * Email verification waiting page
 * Shows instructions to check email for verification link
 */
"use client";

import { useState } from "react";
import { AuthLink, AuthResult } from "@/components/auth/auth-result";
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
    <AuthResult
      tone="info"
      title="Check your email"
      actions={
        <>
          {resendSuccess && (
            <Notice tone="success">Verification email sent. Check your inbox.</Notice>
          )}
          {error && <Notice tone="error">{error}</Notice>}
          <Button
            type="button"
            variant="default"
            width="full"
            onClick={handleResendVerification}
            disabled={!email}
            busy={resending}
          >
            Resend verification email
          </Button>
        </>
      }
      footer={<AuthLink href="/login">Back to login</AuthLink>}
    >
      <p>
        We&apos;ve sent a verification link to{" "}
        <span className="body-bold">{email ?? "your email"}</span>. Use it to
        activate your account.
      </p>
      <p className="mt-8 body-small text-[var(--color-text-tertiary)]">
        Check your spam folder if you don&apos;t see it.
      </p>
    </AuthResult>
  );
}
