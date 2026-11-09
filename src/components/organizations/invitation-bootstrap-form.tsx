"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useSaveRefusal } from "@/components/forms/use-save-refusal";
import { ActionError } from "@/lib/action-error";
import { FormField, FormInput } from "@/components/forms";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { readFieldDirectory, type FieldDirectory } from "@/components/forms/form-error-summary-dom";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { INLINE_HIT_AREA } from "@/components/ui/touch-target";
import { cn } from "@/lib/utils";
import { AuthResult } from "@/components/auth/auth-result";
import {
  bootstrapInvitationAccountAction,
  resendInvitationSetPasswordAction,
} from "@/fn/invitation-bootstrap";
import {
  invitationBootstrapSchema,
  type InvitationBootstrapInput,
} from "@/schemas/organizations";

export function InvitationBootstrapForm({
  invitationId,
  email,
  account = "none",
}: {
  invitationId: string;
  email: string;
  /** "pending": the account exists and only waits for the emailed link. */
  account?: "none" | "pending";
}) {
  const [sent, setSent] = useState(account === "pending");
  const formId = useId();
  // Read on every submit, so the error summary can name and order the fields.
  const [directory, setDirectory] = useState<FieldDirectory | null>(null);
  const [serverError, setServerError] = useState("");
  const {
    register,
    control,
    handleSubmit,
    setError,
    resetField,
    formState: { errors, isSubmitting },
  } = useForm<InvitationBootstrapInput>({
    resolver: zodResolver(invitationBootstrapSchema),
    defaultValues: { invitationId, name: "" },
  });

  const refuseSave = useSaveRefusal({ control, setError, resetField, formId });

  async function submit(values: InvitationBootstrapInput) {
    setServerError("");
    const result = await bootstrapInvitationAccountAction(values);
    if (!result.success) {
      // Keep the issues and code, so a refusal on a field is marked there.
      setServerError(refuseSave(new ActionError(result), result.error) ?? "");
      return;
    }
    setSent(true);
  }
  const busy = isSubmitting;

  if (sent) {
    return <CheckEmail invitationId={invitationId} email={email} sendOnMount={account === "pending"} />;
  }

  return (
    <form id={formId} onSubmit={handleSubmit(submit)} onSubmitCapture={(event) => setDirectory(readFieldDirectory(event.currentTarget))} className="space-y-24">
      <input type="hidden" {...register("invitationId")} />
      <div>
        <p className="body-small text-[var(--color-text-secondary)] mb-6">
          Email
        </p>
        <p className="body-medium text-[var(--color-text-primary)]">{email}</p>
      </div>
      <FormField id="invite-name" label="Name" error={errors.name?.message}>
        <FormInput
          id="invite-name"
          autoComplete="name"
          disabled={busy}
          error={Boolean(errors.name)}
          {...register("name")}
        />
      </FormField>
      <FormErrorSummary
        control={control}
        directory={directory}
        getForm={() => document.getElementById(formId)}
        message={serverError}
      />
      <Button type="submit" variant="primary" width="full" busy={busy}>
        Email me a link
      </Button>
    </form>
  );
}

function CheckEmail({
  invitationId,
  email,
  sendOnMount,
}: {
  invitationId: string;
  email: string;
  /** Reopening a pending invitation asks for a fresh link (the server paces repeats). */
  sendOnMount: boolean;
}) {
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [error, setError] = useState("");
  // Only a confirmed account is cleared by signing in.
  const [accountExists, setAccountExists] = useState(false);
  const mounted = useRef(false);

  async function resend(isRetry: boolean) {
    setResending(true);
    setError("");
    setAccountExists(false);
    setResent(false);
    const result = await resendInvitationSetPasswordAction({ invitationId });
    setResending(false);
    if (!result.success) {
      setError(result.error);
      setAccountExists(result.code === "account_exists");
    } else if (isRetry) setResent(true);
  }

  useEffect(() => {
    if (!sendOnMount || mounted.current) return;
    mounted.current = true;
    void resend(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AuthResult
      framed={false}
      tone="info"
      title="Check your email"
      actions={
        <>
          {resent && (
            <Notice tone="success">
              Link requested. Check your spam folder too.
            </Notice>
          )}
          {error && (
            <Notice
              tone="error"
              action={accountExists ? (
                <Link
                  href={`/login?from=${encodeURIComponent(`/accept-invitation/${invitationId}`)}`}
                  className={cn("underline", INLINE_HIT_AREA)}
                >
                  Sign in
                </Link>
              ) : undefined}
            >
              {error}
            </Notice>
          )}
          <Button type="button" variant="default" width="full" busy={resending} onClick={() => resend(true)}>
            Send again
          </Button>
        </>
      }
    >
      Check {email} for a link to set your password and join. It can take a few minutes to arrive.
    </AuthResult>
  );
}
