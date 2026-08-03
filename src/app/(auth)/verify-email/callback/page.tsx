/**
 * Email verification callback page
 * Handles verification when user clicks link in email
 */
"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";

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
      <div className="w-full max-w-md mx-auto">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-24">
            <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-[var(--clr-dark-purple)]" />
          </div>
          <h1 className="title-heading-2 mb-16">Verifying your email</h1>
          <p className="body-medium text-[var(--color-text-secondary)]">
            This may take a moment.
          </p>
        </div>
      </div>
    );
  }

  if (status === "success") {
    return (
      <div className="w-full max-w-md mx-auto">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-24 bg-[var(--color-status-success-bg)] rounded-full flex items-center justify-center">
            <svg
              className="w-8 h-8 text-[var(--color-status-success)]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>

          <h1 className="title-heading-2 mb-16">Email verified</h1>
          <p className="body-medium text-[var(--color-text-secondary)] mb-24">
            Your email is verified. You are being redirected to sign in.
          </p>

          <Link
            href="/login"
            className="inline-block px-32 py-16 bg-[var(--clr-dark-purple)] text-white rounded-none hover:opacity-90 transition-opacity body-medium"
          >
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="text-center">
        <div className="w-16 h-16 mx-auto mb-24 bg-[var(--color-signal-red)]/10 rounded-full flex items-center justify-center">
          <svg
            className="w-8 h-8 text-[var(--color-signal-red)]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </div>

        <h1 className="title-heading-2 mb-16">Verification failed</h1>
        <p className="body-medium text-[var(--color-text-secondary)] mb-24">
          {error ||
            "Your email could not be verified. Request a new verification email."}
        </p>

        <div className="space-y-16">
          <Link
            href="/verify-email"
            className="inline-block px-32 py-16 bg-[var(--clr-dark-purple)] text-white rounded-none hover:opacity-90 transition-opacity body-medium"
          >
            Resend verification email
          </Link>
          <div>
            <Link
              href="/login"
              className="body-small text-[var(--color-text-tertiary)] hover:text-[var(--clr-dark-purple)]"
            >
              Back to login
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function VerifyEmailCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="w-full max-w-md mx-auto text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-[var(--clr-dark-purple)] mx-auto" />
        </div>
      }
    >
      <VerifyEmailCallbackContent />
    </Suspense>
  );
}
