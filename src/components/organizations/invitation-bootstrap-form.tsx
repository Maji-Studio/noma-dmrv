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
import { bootstrapInvitationAccountAction } from "@/fn/invitation-bootstrap";
import {
  invitationBootstrapSchema,
  type InvitationBootstrapInput,
} from "@/schemas/organizations";

export function InvitationBootstrapForm({
  invitationId,
  email,
}: {
  invitationId: string;
  email: string;
}) {
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
  }
  const busy = isSubmitting;

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
        Create account and join
      </Button>
    </form>
  );
}
