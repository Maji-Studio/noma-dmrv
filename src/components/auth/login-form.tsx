"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "@/lib/auth/client";
import Link from "next/link";
import { Button } from "@/components/ui";
import { loginSchema, type LoginFormData } from "@/schemas/auth";
import { FormField, FormInput, ServerError } from "@/components/forms";

export function LoginForm() {
  const [serverError, setServerError] = useState("");
  const [showResendVerification, setShowResendVerification] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);

  const { signIn, resendVerification } = useAuth();
  const router = useRouter();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    getValues,
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  async function onSubmit(data: LoginFormData) {
    setServerError("");
    setShowResendVerification(false);
    setResendSuccess(false);

    const result = await signIn(data.email, data.password);

    if (result.success) {
      router.push("/projects");
    } else {
      setServerError(result.error || "Failed to sign in");

      // Show resend verification option if email not verified
      if (
        result.error?.toLowerCase().includes("not verified") ||
        result.error?.toLowerCase().includes("verify")
      ) {
        setShowResendVerification(true);
      }
    }
  }

  async function handleResendVerification() {
    setResendLoading(true);
    setResendSuccess(false);

    const email = getValues("email");
    const result = await resendVerification(email);

    if (result.success) {
      setResendSuccess(true);
      setServerError("");
    } else {
      setServerError(result.error || "Failed to resend verification email");
    }

    setResendLoading(false);
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-24">
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

      <FormField id="password" label="Password" error={errors.password?.message}>
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

      <ServerError message={serverError} />

      {showResendVerification && !resendSuccess && (
        <div className="p-s bg-[var(--color-background-interaction-light)] border border-[var(--color-border-secondary)] rounded-none">
          <p className="body-small text-[var(--color-text-secondary)] mb-xs">
            Your email address needs to be verified.
          </p>
          <button
            type="button"
            onClick={handleResendVerification}
            disabled={resendLoading}
            className="body-small text-[var(--clr-dark-purple)] hover:underline disabled:opacity-50"
          >
            {resendLoading ? "Sending..." : "Resend verification email"}
          </button>
        </div>
      )}

      {resendSuccess && (
        <div
          className="p-s bg-green-50 border border-green-500 rounded-none text-green-700 body-small"
          role="status"
          aria-live="polite"
        >
          Verification email sent! Please check your inbox.
        </div>
      )}

      <div className="flex items-center justify-between">
        <Link
          href="/forgot-password"
          className="body-small text-[var(--clr-dark-purple)] hover:underline"
        >
          Forgot password?
        </Link>
      </div>

      <Button
        type="submit"
        variant="primary"
        width="full"
        disabled={isSubmitting}
      >
        {isSubmitting ? "Signing in..." : "Sign In"}
      </Button>
    </form>
  );
}
