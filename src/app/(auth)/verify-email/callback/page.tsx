/**
 * Email verification callback page
 * Handles verification when user clicks link in email
 */
"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import {
  AuthLink,
  AuthPrimaryLink,
  AuthResult,
} from "@/components/auth/auth-result";

function VerifyEmailCallbackContent() {
  const [status, setStatus] = useState<"verifying" | "success" | "error">(
    "verifying"
  );
  const [error, setError] = useState("");

  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    async function verifyEmail() {
      const token = searchParams.get("token");

      if (!token) {
        setStatus("error");
        setError("This verification link is invalid. Request a new email.");
        return;
      }

      try {
        // Call the Better Auth verification endpoint
        const response = await fetch("/api/auth/verify-email", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ token }),
        });

        if (response.ok) {
          setStatus("success");
          // Redirect to login after 2 seconds
          setTimeout(() => {
            router.push("/login");
          }, 2000);
        } else {
          const data = await response.json();
          setStatus("error");
          setError(
            data.message ||
              "Your email could not be verified. Request a new verification email.",
          );
        }
      } catch {
        setStatus("error");
        setError(
          "Your email could not be verified. Check your connection and try again.",
        );
      }
    }

    verifyEmail();
  }, [searchParams, router]);

  if (status === "verifying") {
    return (
      <AuthResult tone="pending" title="Verifying your email">
        This may take a moment.
      </AuthResult>
    );
  }

  if (status === "success") {
    return (
      <AuthResult
        tone="success"
        title="Email verified"
        actions={<AuthPrimaryLink href="/login">Sign in</AuthPrimaryLink>}
      >
        Your email is verified. You are being redirected to sign in.
      </AuthResult>
    );
  }

  return (
    <AuthResult
      tone="error"
      title="Verification failed"
      actions={
        <AuthPrimaryLink href="/verify-email">
          Resend verification email
        </AuthPrimaryLink>
      }
      footer={<AuthLink href="/login">Back to login</AuthLink>}
    >
      {error ||
        "Your email could not be verified. Request a new verification email."}
    </AuthResult>
  );
}

export default function VerifyEmailCallbackPage() {
  return (
    <Suspense
      fallback={
        <AuthResult tone="pending" title="Verifying your email" />
      }
    >
      <VerifyEmailCallbackContent />
    </Suspense>
  );
}
