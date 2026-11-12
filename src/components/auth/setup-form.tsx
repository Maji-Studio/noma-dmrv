"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui";
import { PHONE_TOUCH_TARGET } from "@/components/ui/touch-target";
import {
  FormField,
  FormInput,
  ResolvedErrorRevalidator,
  ServerError,
} from "@/components/forms";
import { createFirstAdminAction } from "@/fn/first-run";
import {
  FIRST_ADMIN_SETUP_FALLBACK,
  firstAdminFormSchema,
  type FirstAdminFormData,
} from "@/schemas/first-run";
import { useLatchedSubmit } from "@/hooks/use-latched-submit";
import { AuthPrimaryLink, AuthResult } from "./auth-result";

export function SetupForm() {
  const [serverError, setServerError] = useState("");
  const [warning, setWarning] = useState<{
    message: string;
    href: string;
  } | null>(null);
  const router = useRouter();
  const latched = useLatchedSubmit();
  // Hold busy through the navigation; clear it only on a failure.
  const [navigating, startNavigation] = useTransition();

  const {
    register,
    handleSubmit,
    control,
    trigger,
    formState: { errors, isSubmitting },
  } = useForm<FirstAdminFormData>({
    resolver: zodResolver(firstAdminFormSchema),
    defaultValues: { email: "", password: "", confirmPassword: "" },
  });

  async function onSubmit(data: FirstAdminFormData) {
    setServerError("");
    const result = await createFirstAdminAction({
      email: data.email,
      password: data.password,
    });

    if (!result.success) {
      setServerError(
        result.error || FIRST_ADMIN_SETUP_FALLBACK,
      );
      return;
    }
    if (result.warning) {
      // The account exists but no session started: show the notice, then offer sign-in.
      setWarning({ message: result.warning, href: result.data.redirectTo });
      return;
    }
    startNavigation(() => router.push(result.data.redirectTo));
  }

  const busy = isSubmitting || navigating;

  // The account exists but no session started: the result replaces the whole page, heading included.
  if (warning) {
    return (
      <AuthResult
        tone="success"
        title="Account ready"
        actions={<AuthPrimaryLink href={warning.href}>Sign in</AuthPrimaryLink>}
      >
        {warning.message}
      </AuthResult>
    );
  }

  return (
    <div className="w-full max-w-[400px] mx-auto">
      <div className="mb-32 text-center">
        <h1 className="title-heading-2">Set up noma dMRV</h1>
        <p className="body-medium text-[var(--color-text-secondary)] mt-8">
          Choose the email and password for the first Platform Admin account.
        </p>
      </div>

      <div className="bg-[var(--color-background-white)] rounded-none border border-[var(--color-border-primary)] p-32 shadow-sm">
        <form
          method="post"
          onSubmit={latched(handleSubmit(onSubmit))}
          className="space-y-24"
        >
          <ResolvedErrorRevalidator control={control} trigger={trigger} />
          <FormField id="email" label="Email" error={errors.email?.message}>
            <FormInput
              id="email"
              type="email"
              placeholder="name@company.com"
              disabled={busy}
              error={!!errors.email}
              aria-label="Email address"
              {...register("email")}
            />
          </FormField>

          <FormField
            id="password"
            label="Password"
            cue="Minimum 8 characters"
            error={errors.password?.message}
          >
            <FormInput
              id="password"
              type="password"
              placeholder="Enter your password"
              disabled={busy}
              error={!!errors.password}
              aria-label="Password"
              {...register("password")}
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
              placeholder="Confirm your password"
              disabled={busy}
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
            className={PHONE_TOUCH_TARGET}
            busy={busy}
          >
            Create Platform Admin account
          </Button>
        </form>
      </div>
    </div>
  );
}
