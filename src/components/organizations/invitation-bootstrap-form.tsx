"use client";

import { useId, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useSaveRefusal } from "@/components/forms/use-save-refusal";
import { ActionError } from "@/lib/action-error";
import { FormField, FormInput } from "@/components/forms";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { readFieldDirectory, type FieldDirectory } from "@/components/forms/form-error-summary-dom";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
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
    return <CheckEmail invitationId={invitationId} email={email} />;
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
        Send set-password link
      </Button>
    </form>
  );
}

function CheckEmail({ invitationId, email }: { invitationId: string; email: string }) {
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [error, setError] = useState("");

  async function resend() {
    setResending(true);
    setError("");
    setResent(false);
    const result = await resendInvitationSetPasswordAction({ invitationId });
    setResending(false);
    if (result.success) setResent(true);
    else setError(result.error);
  }

  return (
    <AuthResult
      framed={false}
      tone="info"
      title="Check your email"
      actions={
        <>
          {resent && (
            <Notice tone="success">
              Link requested. If it is not there in a few minutes, check your spam folder.
            </Notice>
          )}
          {error && <Notice tone="error">{error}</Notice>}
          <Button type="button" variant="default" width="full" busy={resending} onClick={resend}>
            Send again
          </Button>
        </>
      }
    >
      We sent a link to {email}. Open it to set your password and join.
    </AuthResult>
  );
}
