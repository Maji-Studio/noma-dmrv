"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "@/lib/auth/client";
import Link from "next/link";
import { Button } from "@/components/ui";
import { setPasswordSchema, type SetPasswordFormData } from "@/schemas/auth";
import { FormField, FormInput, ServerError } from "@/components/forms";

function SetPasswordFormContent() {
  const [success, setSuccess] = useState(false);
  const [serverError, setServerError] = useState("");

  const searchParams = useSearchParams();
  const router = useRouter();
  const { resetPassword, getCurrentUserEmail } = useAuth();

  const token = searchParams.get("token");

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SetPasswordFormData>({
    resolver: zodResolver(setPasswordSchema),
    defaultValues: {
      password: "",
      confirmPassword: "",
    },
  });

  async function onSubmit(data: SetPasswordFormData) {
    setServerError("");

    // Validate token exists
    if (!token) {
      setServerError("Invalid invitation link. Please contact your administrator.");
      return;
    }

    const result = await resetPassword(token, data.password);

    if (result.success) {
      setSuccess(true);

      // Get user email and store it for the verify-email page
      const email = await getCurrentUserEmail();
      if (email) {
        sessionStorage.setItem("pendingVerificationEmail", email);
      }

      // Redirect to verify-email page after 2 seconds
      setTimeout(() => {
        router.push("/verify-email");
      }, 2000);
    } else {
      setServerError(result.error || "Failed to set password");
    }
  }

  // Show error if no token in URL
  if (!token) {
    return (
      <div className="space-y-24">
        <div
          className="p-m bg-[var(--color-signal-red)]/10 border border-[var(--color-signal-red)] rounded-none text-[var(--color-signal-red)]"
          role="alert"
        >
          <h3 className="body-medium font-semibold mb-xs">Invalid Invitation Link</h3>
          <p className="body-small">
            This invitation link is invalid or has expired. Please contact your
            administrator for a new invitation.
          </p>
        </div>

        <div className="text-center">
          <Link
            href="/login"
            className="body-medium text-[var(--clr-dark-purple)] hover:underline"
          >
            Back to login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-24">
      {success ? (
        <div className="space-y-24">
          <div
            className="p-m bg-green-50 border border-green-500 rounded-none text-green-700"
            role="status"
            aria-live="polite"
          >
            <h3 className="body-medium font-semibold mb-xs">
              Password set successfully
            </h3>
            <p className="body-small">
              Your password has been set. Please verify your email address to
              complete your account setup. Redirecting...
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="mb-m">
            <h2 className="body-large font-semibold text-[var(--color-text-primary)]">
              Set Your Password
            </h2>
            <p className="body-small text-[var(--color-text-secondary)] mt-xs">
              Create a secure password for your account
            </p>
          </div>

          <FormField
            id="password"
            label="Password"
            helperText="Minimum 8 characters"
            error={errors.password?.message}
          >
            <FormInput
              id="password"
              type="password"
              placeholder="Enter your password"
              disabled={isSubmitting}
              error={!!errors.password}
              aria-label="Password"
              {...register("password")}
            />
          </FormField>

          <FormField
            id="confirmPassword"
            label="Confirm Password"
            error={errors.confirmPassword?.message}
          >
            <FormInput
              id="confirmPassword"
              type="password"
              placeholder="Confirm your password"
              disabled={isSubmitting}
              error={!!errors.confirmPassword}
              aria-label="Confirm password"
              {...register("confirmPassword")}
            />
          </FormField>

          <ServerError message={serverError} />

          <Button
            type="submit"
            variant="primary"
            width="full"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Setting password..." : "Set Password"}
          </Button>
        </>
      )}
    </form>
  );
}

/**
 * SetPasswordForm component for new user invitations
 * Must be wrapped in Suspense boundary when used in a page
 */
export function SetPasswordForm() {
  return <SetPasswordFormContent />;
}
