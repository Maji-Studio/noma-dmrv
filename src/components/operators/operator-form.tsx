"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormField, FormInput } from "@/components/forms";
import { FormActions } from "@/components/forms/form-actions";
import {
  operatorFormSchema,
  type OperatorFormData,
} from "@/schemas/operators";
import type { Operator } from "@/db/schema/parties";

interface OperatorFormProps {
  operator?: Operator;
  onSubmit: (data: OperatorFormData) => Promise<void> | void;
  onCancel?: () => void;
  isSubmitting?: boolean;
  errorMessage?: string;
  submitLabel?: string;
}

export function OperatorForm({
  operator,
  onSubmit,
  onCancel,
  isSubmitting = false,
  errorMessage,
  submitLabel,
}: OperatorFormProps) {
  const isEditMode = !!operator;

  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<OperatorFormData>({
    resolver: zodResolver(operatorFormSchema),
    defaultValues: {
      name: operator?.name ?? "",
      credentials: operator?.credentials ?? "",
      contactPhone: operator?.contactPhone ?? "",
    },
  });

  return (
    <form onSubmit={handleSubmit((data) => onSubmit(data))} className="space-y-20">
      <FormField id="name" label="Name" error={errors.name?.message} required>
        <FormInput
          id="name"
          type="text"
          placeholder="e.g., Jane Doe"
          disabled={isSubmitting}
          error={!!errors.name}
          autoFocus
          {...register("name")}
        />
      </FormField>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
        <FormField
          id="credentials"
          label="Role / credentials"
          hint="The operator's job role or any relevant qualifications and certifications. Optional."
          error={errors.credentials?.message}
        >
          <FormInput
            id="credentials"
            type="text"
            placeholder="e.g. Lead operator, lab certification"
            disabled={isSubmitting}
            error={!!errors.credentials}
            {...register("credentials")}
          />
        </FormField>

        <FormField
          id="contactPhone"
          label="Contact phone"
          error={errors.contactPhone?.message}
        >
          <FormInput
            id="contactPhone"
            type="tel"
            placeholder="e.g., +255 754 000 000"
            disabled={isSubmitting}
            error={!!errors.contactPhone}
            {...register("contactPhone")}
          />
        </FormField>
      </div>

      <FormActions
        control={control}
        onCancel={onCancel}
        isSubmitting={isSubmitting}
        errorMessage={errorMessage}
        submitLabel={submitLabel}
        defaultSubmitLabel={isEditMode ? "Update Operator" : "Create Operator"}
      />
    </form>
  );
}
