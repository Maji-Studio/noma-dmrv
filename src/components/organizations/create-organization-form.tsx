"use client";

import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormActions, FormField, FormInput } from "@/components/forms";
import { useSaveRefusal } from "@/components/forms/use-save-refusal";
import { useToast } from "@/components/ui/toast";
import { useLatchedSubmit } from "@/hooks/use-latched-submit";
import { useCreateOrganization } from "@/hooks/use-organizations";
import { createOrganizationSchema, type CreateOrganizationInput } from "@/schemas/organizations";

export interface CreatedOrganization {
  organizationId: string;
  organizationName: string;
  /** Set when the first Admin had no account: the link to send them. */
  invitation: { email: string; acceptUrl: string } | null;
}

interface CreateOrganizationFormProps {
  onCreated: (created: CreatedOrganization) => void;
  onCancel: () => void;
}

/**
 * New organization: a name and its first Admin. The slug follows the name
 * (#1367). An address with no account gets an Admin invitation instead of a
 * membership (#1373, Q3); the Platform page shows its link to send.
 */
export function CreateOrganizationForm({ onCreated, onCancel }: CreateOrganizationFormProps) {
  const toast = useToast();
  const create = useCreateOrganization();
  const latched = useLatchedSubmit();
  const formId = useId();
  const [serverError, setServerError] = useState("");
  const {
    control,
    register,
    handleSubmit,
    resetField,
    setError,
    formState: { errors },
  } = useForm<CreateOrganizationInput>({
    resolver: zodResolver(createOrganizationSchema),
    defaultValues: { name: "", adminEmail: "" },
  });
  const refuseSave = useSaveRefusal({ control, setError, resetField, formId });

  const onSubmit = latched(handleSubmit(async (values) => {
    setServerError("");
    try {
      const result = await create.mutateAsync(values);
      toast.success(`${result.organizationName} created.`);
      onCreated({
        organizationId: result.organizationId,
        organizationName: result.organizationName,
        invitation: result.firstAdmin.kind === "invited"
          ? { email: values.adminEmail, acceptUrl: result.firstAdmin.acceptUrl }
          : null,
      });
    } catch (error) {
      setServerError(refuseSave(
        error,
        error instanceof Error ? error.message : "The organization was not created. Try again.",
      ) ?? "");
    }
  }));

  return (
    <form id={formId} onSubmit={onSubmit} className="flex flex-col gap-16" aria-label="New organization">
      <FormField id="org-name" label="Name" error={errors.name?.message} required>
        <FormInput id="org-name" placeholder="Kilombero Carbon" error={!!errors.name} {...register("name")} />
      </FormField>
      <FormField
        id="org-admin-email"
        label="First Admin"
        error={errors.adminEmail?.message}
        cue="Their email. Without an account they get an invitation to join as Admin."
        required
      >
        <FormInput id="org-admin-email" type="email" placeholder="name@example.com" error={!!errors.adminEmail} {...register("adminEmail")} />
      </FormField>
      <FormActions
        control={control}
        isSubmitting={create.isPending}
        errorMessage={serverError}
        submitLabel="Create organization"
        submittingLabel="Creating…"
        onCancel={onCancel}
        sticky={false}
      />
    </form>
  );
}
