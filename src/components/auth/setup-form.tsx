"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui";
import { PHONE_TOUCH_TARGET } from "@/components/ui/touch-target";
import { Notice } from "@/components/ui/notice";
import { FormField, FormInput, ServerError } from "@/components/forms";
import { createFirstAdminAction } from "@/fn/first-run";
import { firstAdminFormSchema, type FirstAdminFormData } from "@/schemas/first-run";
import { AuthPrimaryLink } from "./auth-result";

export function SetupForm() {
  const [serverError, setServerError] = useState("");
  const [warning, setWarning] = useState<{ message: string; href: string } | null>(null);
  const router = useRouter();
  // Hold busy through the navigation; clear it only on a failure.
  const [navigating, startNavigation] = useTransition();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FirstAdminFormData>({
    resolver: zodResolver(firstAdminFormSchema),
    defaultValues: { email: "", password: "", confirmPassword: "" },
  });

  async function onSubmit(data: FirstAdminFormData) {
    setServerError("");
    const result = await createFirstAdminAction({ email: data.email, password: data.password });

    if (!result.success) {
      setServerError(result.error || "Your admin account could not be created. Try again.");
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

  if (warning) {
    return (
      <div className="space-y-24">
        <Notice tone="success">{warning.message}</Notice>
        <AuthPrimaryLink href={warning.href}>Go to sign in</AuthPrimaryLink>
      </div>
    );
  }

  return (
    <form method="post" onSubmit={handleSubmit(onSubmit)} className="space-y-24">
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

      <FormField id="password" label="Password" cue="Minimum 8 characters" error={errors.password?.message}>
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

      <FormField id="confirmPassword" label="Confirm password" error={errors.confirmPassword?.message}>
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

      <Button type="submit" variant="primary" width="full" className={PHONE_TOUCH_TARGET} busy={busy}>
        Create admin account
      </Button>
    </form>
  );
}
