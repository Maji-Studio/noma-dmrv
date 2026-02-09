"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "@/lib/auth/client";
import Link from "next/link";
import { Button } from "@/components/ui";
import {
  forgotPasswordSchema,
  type ForgotPasswordFormData,
} from "@/schemas/auth";
import { FormField, FormInput, ServerError } from "@/components/forms";

export function ForgotPasswordForm() {
  const [success, setSuccess] = useState(false);
  const [serverError, setServerError] = useState("");

  const { requestPasswordReset } = useAuth();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<ForgotPasswordFormData>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: {
      email: "",
    },
  });

  async function onSubmit(data: ForgotPasswordFormData) {
    setServerError("");
    setSuccess(false);

    const result = await requestPasswordReset(data.email);

    if (result.success) {
      setSuccess(true);
      reset();
    } else {
      setServerError(result.error || "Failed to send reset link");
    }
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
            <h3 className="body-medium font-semibold mb-xs">Check your email</h3>
            <p className="body-small">
              If an account exists with that email address, we&apos;ve sent a
              password reset link. Please check your inbox and follow the
              instructions.
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
      ) : (
        <>
          <FormField id="email" label="Email" error={errors.email?.message}>
            <FormInput
              id="email"
              type="email"
              placeholder="your@email.com"
              disabled={isSubmitting}
              error={!!errors.email}
              aria-label="Email address"
              {...register("email")}
            />
          </FormField>

          <ServerError message={serverError} />

          <Button
            type="submit"
            variant="primary"
            width="full"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Sending..." : "Send Reset Link"}
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
