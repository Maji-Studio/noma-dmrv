"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormField, FormInput } from "@/components/forms";
import { FormActions } from "@/components/forms/form-actions";
import {
  driverFormSchema,
  type DriverFormData,
} from "@/schemas/drivers";
import type { Driver } from "@/db/schema/parties";

interface DriverFormProps {
  driver?: Driver;
  onSubmit: (data: DriverFormData) => Promise<void> | void;
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
  const isEditMode = !!driver;

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<DriverFormData>({
    resolver: zodResolver(driverFormSchema),
    defaultValues: {
      name: driver?.name ?? "",
      licenseNumber: driver?.licenseNumber ?? "",
      contactPhone: driver?.contactPhone ?? "",
    },
  });

  return (
    <form onSubmit={handleSubmit((data) => onSubmit(data))} className="space-y-20">
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
          label="License Number"
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
          label="Contact Phone"
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
        onCancel={onCancel}
        isSubmitting={isSubmitting}
        errorMessage={errorMessage}
        submitLabel={submitLabel}
        defaultSubmitLabel={isEditMode ? "Update Driver" : "Create Driver"}
      />
    </form>
  );
}
