"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "@/lib/auth/client";
import Link from "next/link";
import { Button } from "@/components/ui";
import { PHONE_TOUCH_TARGET } from "@/components/ui/touch-target";
import { setPasswordSchema, type SetPasswordFormData } from "@/schemas/auth";
import {
  FormField,
  FormInput,
  ResolvedErrorRevalidator,
  ServerError,
} from "@/components/forms";
import { Notice } from "@/components/ui/notice";
import { AuthPrimaryLink, AuthResult } from "./auth-result";

export interface SetPasswordInvitation {
  id: string;
  email: string;
}

function SetPasswordFormContent({ invitation }: { invitation?: SetPasswordInvitation }) {
  const [success, setSuccess] = useState(false);
  // Stays busy through the sign-in and the navigation to the accept page.
  const [joining, setJoining] = useState(false);
  const [linkRefused, setLinkRefused] = useState(false);
  const [serverError, setServerError] = useState("");

  const searchParams = useSearchParams();
  const router = useRouter();
  const { resetPassword, signIn } = useAuth();

  const token = searchParams.get("token");
  const linkFailed = Boolean(searchParams.get("error"));
  const acceptPath = invitation
    ? `/accept-invitation/${encodeURIComponent(invitation.id)}`
    : null;

  const {
    register,
    handleSubmit,
    control,
    trigger,
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
      setServerError("This invitation link is invalid. Ask your Admin for a new one.");
      return;
    }

    const result = await resetPassword(token, data.password);

    if (result.success && invitation && acceptPath) {
      setJoining(true);
      // The link confirms the mailbox but starts no session: sign in with
      // the password just set, then accept through the signed-in path.
      const signedIn = await signIn(invitation.email, data.password);
      router.push(
        signedIn.success
          ? acceptPath
          : `/login?from=${encodeURIComponent(acceptPath)}`,
      );
      return;
    }

    if (!result.success && invitation) {
      // A refused token on the invitation path has one way forward: a new link.
      setLinkRefused(true);
      return;
    }

    if (result.success) {
      setSuccess(true);

      // The token confirmed the email, so sign-in is the next step.
      setTimeout(() => {
        router.push("/login");
      }, 2000);
    } else {
      setServerError(
        result.error || "The password was not set. Check the form and try again.",
      );
    }
  }

  if (invitation && acceptPath && (!token || linkFailed || linkRefused)) {
    return (
      <AuthResult
        framed={false}
        tone="error"
        title="Link no longer works"
        actions={<AuthPrimaryLink href={acceptPath}>Open invitation</AuthPrimaryLink>}
      >
        Open your invitation to send a new link to {invitation.email}.
      </AuthResult>
    );
  }

  // Show error if no token in URL
  if (!token) {
    return (
      <div className="space-y-24">
        <Notice tone="error" title="Invalid invitation link">
          This invitation link is invalid or has expired. Ask your Admin for a new invitation.
        </Notice>

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
      <ResolvedErrorRevalidator control={control} trigger={trigger} />
      {success ? (
        <div className="space-y-24">
          <Notice tone="success" title="Password set">
            Taking you to sign in.
          </Notice>
        </div>
      ) : (
        <>
          <div className="mb-24">
            <h2 className="body-large-bold text-[var(--color-text-primary)]">
              Set your password
            </h2>
            {invitation && (
              <div className="mt-16">
                <p className="body-small text-[var(--color-text-secondary)] mb-6">
                  Email
                </p>
                <p className="body-medium text-[var(--color-text-primary)]">{invitation.email}</p>
              </div>
            )}
          </div>

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
              disabled={isSubmitting}
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
            className={PHONE_TOUCH_TARGET}
            busy={isSubmitting || joining}
          >
            {invitation ? "Set password and continue" : "Set password"}
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
export function SetPasswordForm({ invitation }: { invitation?: SetPasswordInvitation } = {}) {
  return <SetPasswordFormContent invitation={invitation} />;
}
