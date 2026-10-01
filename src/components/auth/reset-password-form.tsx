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
import {
  FormField,
  FormInput,
  ResolvedErrorRevalidator,
  ServerError,
} from "@/components/forms";
import { AuthLink, AuthResult } from "./auth-result";

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
    control,
    trigger,
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
      setServerError("This reset link is invalid. Request a new password reset.");
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
      setServerError(
        result.error ||
          "The password was not reset. Check the form and try again.",
      );
    }
  }

  // Show error if no token in URL
  if (!token) {
    return (
      <AuthResult
        framed={false}
        tone="error"
        title="Invalid reset link"
        footer={<AuthLink href="/forgot-password">Request new reset link</AuthLink>}
      >
        This password reset link is invalid or has expired. Request a new password reset.
      </AuthResult>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-24">
      <ResolvedErrorRevalidator control={control} trigger={trigger} />
      {success ? (
        <AuthResult framed={false} tone="success" title="Password reset">
          Your password has been reset. Redirecting to login…
        </AuthResult>
      ) : (
        <>
          <FormField
            id="newPassword"
            label="New password"
            cue="Minimum 8 characters"
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
            label="Confirm password"
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
            {isSubmitting ? "Resetting..." : "Reset password"}
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
