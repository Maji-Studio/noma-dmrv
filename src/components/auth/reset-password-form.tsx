"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "@/lib/auth/client";
import Link from "next/link";
import { Button } from "@/components/ui";
import {
  resetPasswordSchema,
  type ResetPasswordFormData,
} from "@/schemas/auth";
import { FormField, FormInput, ServerError } from "@/components/forms";

function ResetPasswordFormContent() {
  const [success, setSuccess] = useState(false);
  const [serverError, setServerError] = useState("");

  const searchParams = useSearchParams();
  const router = useRouter();
  const { resetPassword } = useAuth();

  const token = searchParams.get("token");

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordFormData>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: {
      newPassword: "",
      confirmPassword: "",
    },
  });

  async function onSubmit(data: ResetPasswordFormData) {
    setServerError("");

    // Validate token exists
    if (!token) {
      setServerError("Invalid reset link. Please request a new password reset.");
      return;
    }

    const result = await resetPassword(token, data.newPassword);

    if (result.success) {
      setSuccess(true);
      // Redirect to login after 2 seconds
      setTimeout(() => {
        router.push("/login");
      }, 2000);
    } else {
      setServerError(result.error || "Failed to reset password");
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
          <h3 className="body-medium font-semibold mb-xs">Invalid Reset Link</h3>
          <p className="body-small">
            This password reset link is invalid or has expired. Please request a
            new password reset.
          </p>
        </div>

        <div className="text-center">
          <Link
            href="/forgot-password"
            className="body-medium text-[var(--clr-dark-purple)] hover:underline"
          >
            Request new reset link
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
              Password reset successful
            </h3>
            <p className="body-small">
              Your password has been reset. Redirecting to login...
            </p>
          </div>
        </div>
      ) : (
        <>
          <FormField
            id="newPassword"
            label="New Password"
            helperText="Minimum 8 characters"
            error={errors.newPassword?.message}
          >
            <FormInput
              id="newPassword"
              type="password"
              placeholder="Enter new password"
              disabled={isSubmitting}
              error={!!errors.newPassword}
              aria-label="New password"
              {...register("newPassword")}
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
              placeholder="Confirm new password"
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
            {isSubmitting ? "Resetting..." : "Reset Password"}
          </Button>

          <div className="text-center">
            <Link
              href="/login"
              className="body-small text-[var(--clr-dark-purple)] hover:underline"
            >
              Back to login
            </Link>
          </div>
        </>
      )}
    </form>
  );
}

/**
 * ResetPasswordForm component
 * Must be wrapped in Suspense boundary when used in a page
 */
export function ResetPasswordForm() {
  return <ResetPasswordFormContent />;
}
