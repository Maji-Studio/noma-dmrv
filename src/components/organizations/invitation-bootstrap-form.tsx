"use client";

import { useId, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useSaveRefusal } from "@/components/forms/use-save-refusal";
import { ActionError } from "@/lib/action-error";
import { FormActions, FormField, FormInput } from "@/components/forms";
import { useBusyUntilUnload } from "@/hooks/use-busy-until-unload";
import { bootstrapInvitationAccountAction } from "@/fn/invitation-bootstrap";
import { stashPendingWarning } from "@/lib/pending-warning";
import { stashOrgSwitchNotice } from "@/lib/org-switch-notice";
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
  const [serverError, setServerError] = useState("");
  // The page reloads into the dashboard after the action returns; stay busy through that.
  const leaving = useBusyUntilUnload();
  const {
    register,
    control,
    handleSubmit,
    setError,
    resetField,
    formState: { errors, isSubmitting },
  } = useForm<InvitationBootstrapInput>({
    resolver: zodResolver(invitationBootstrapSchema),
    defaultValues: { invitationId, name: "", password: "" },
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
    // The account exists and the invitation is accepted. A warning says only
    // that the organization was not remembered as the default, so it is handed
    // to the dashboard rather than lost to this reload.
    stashPendingWarning(result.warning);
    stashOrgSwitchNotice();
    leaving.hold(true);
    window.location.assign("/dashboard");
  }
  const busy = isSubmitting || !!leaving.held;

  return (
    <form id={formId} onSubmit={handleSubmit(submit)} className="space-y-24">
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
      <FormField
        id="invite-password"
        label="Password"
        error={errors.password?.message}
      >
        <FormInput
          id="invite-password"
          type="password"
          autoComplete="new-password"
          disabled={busy}
          error={Boolean(errors.password)}
          {...register("password")}
        />
      </FormField>
      <FormActions
        control={control}
        isSubmitting={busy}
        errorMessage={serverError}
        submitLabel="Create account and join"
        submitClassName="w-full"
        sticky={false}
      />
    </form>
  );
}
