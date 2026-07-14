"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { FormField, FormInput, ServerError } from "@/components/forms";
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
  const [serverError, setServerError] = useState("");
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<InvitationBootstrapInput>({
    resolver: zodResolver(invitationBootstrapSchema),
    defaultValues: { invitationId, name: "", password: "" },
  });

  async function submit(values: InvitationBootstrapInput) {
    setServerError("");
    const result = await bootstrapInvitationAccountAction(values);
    if (!result.success) {
      setServerError(result.error);
      return;
    }
    window.location.assign("/dashboard");
  }

  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-24">
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
          disabled={isSubmitting}
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
          disabled={isSubmitting}
          error={Boolean(errors.password)}
          {...register("password")}
        />
      </FormField>
      <ServerError message={serverError} />
      <Button
        type="submit"
        variant="primary"
        width="full"
        disabled={isSubmitting}
      >
        {isSubmitting ? "Creating account…" : "Create account and join"}
      </Button>
    </form>
  );
}
