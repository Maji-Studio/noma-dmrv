"use client";

import { useId } from "react";
import { useLatchedSubmit } from "@/hooks/use-latched-submit";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormField, FormInput } from "@/components/forms";
import { FormActions } from "@/components/forms/form-actions";
import { useSaveRefusal, type SaveRefusalHandler } from "@/components/forms/use-save-refusal";
import {
  driverFormSchema,
  type DriverFormData,
} from "@/schemas/drivers";
import type { Driver } from "@/db/schema/parties";

interface DriverFormProps {
  driver?: Driver;
  /** `onRefusal` shows a refused save at the fields it names (#1327). */
  onSubmit: (data: DriverFormData, onRefusal: SaveRefusalHandler) => Promise<void> | void;
  onCancel?: () => void;
  isSubmitting?: boolean;
  errorMessage?: string;
  submitLabel?: string;
}

export function DriverForm({
  driver,
  onSubmit,
  onCancel,
  isSubmitting = false,
  errorMessage,
  submitLabel,
}: DriverFormProps) {
  const latched = useLatchedSubmit();
  const formId = useId();
  const isEditMode = !!driver;

  const {
    control,
    register,
    handleSubmit,
    setError,
    resetField,
    formState: { errors },
  } = useForm<DriverFormData>({
    resolver: zodResolver(driverFormSchema),
    defaultValues: {
      name: driver?.name ?? "",
      licenseNumber: driver?.licenseNumber ?? "",
      contactPhone: driver?.contactPhone ?? "",
    },
  });

  const refuseSave = useSaveRefusal({ control, setError, resetField, formId });

  return (
    <form id={formId} onSubmit={latched(handleSubmit((data) => onSubmit(data, refuseSave)))} className="space-y-20">
      <FormField id="name" label="Name" error={errors.name?.message} required>
        <FormInput
          id="name"
          type="text"
          placeholder="e.g., Driver name"
          disabled={isSubmitting}
          error={!!errors.name}
          autoFocus
          {...register("name")}
        />
      </FormField>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
        <FormField
          id="licenseNumber"
          label="License number"
          error={errors.licenseNumber?.message}
        >
          <FormInput
            id="licenseNumber"
            type="text"
            placeholder="Optional license number"
            disabled={isSubmitting}
            error={!!errors.licenseNumber}
            {...register("licenseNumber")}
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
        defaultSubmitLabel={isEditMode ? "Update driver" : "Create driver"}
      />
    </form>
  );
}
