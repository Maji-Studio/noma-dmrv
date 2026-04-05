"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormField, FormInput, FormTextarea } from "@/components/forms";
import { FormSelect } from "@/components/forms/form-select";
import { FormActions } from "@/components/forms/form-actions";
import {
  feedstockTypeFormSchema,
  FEEDSTOCK_CATEGORY_OPTIONS,
  type FeedstockTypeFormData,
} from "@/schemas/feedstock-types";
import type { FeedstockType } from "@/db/schema/feedstock";

interface FeedstockTypeFormProps {
  feedstockType?: FeedstockType;
  onSubmit: (data: FeedstockTypeFormData) => Promise<void> | void;
  onCancel?: () => void;
  isSubmitting?: boolean;
  submitLabel?: string;
  /** Optional hint text shown above the form fields */
  hint?: string;
}

export function FeedstockTypeForm({
  feedstockType,
  onSubmit,
  onCancel,
  isSubmitting = false,
  submitLabel,
  hint,
}: FeedstockTypeFormProps) {
  const isEditMode = !!feedstockType;

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FeedstockTypeFormData>({
    resolver: zodResolver(feedstockTypeFormSchema),
    defaultValues: {
      name: feedstockType?.name ?? "",
      category: (feedstockType?.category as FeedstockTypeFormData["category"]) ?? undefined,
      description: feedstockType?.description ?? "",
      registryUrl: feedstockType?.registryUrl ?? "",
    },
  });

  return (
    <form onSubmit={handleSubmit((data) => onSubmit(data))} className="space-y-20">
      {hint && (
        <p className="text-[var(--text-s)] text-[var(--color-text-tertiary)]">
          {hint}
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
        <FormField
          id="category"
          label="Category"
          error={errors.category?.message}
          required
        >
          <FormSelect
            id="category"
            placeholder="Select category..."
            disabled={isSubmitting}
            error={!!errors.category}
            options={FEEDSTOCK_CATEGORY_OPTIONS}
            {...register("category")}
          />
        </FormField>

        <FormField id="name" label="Name" error={errors.name?.message} required>
          <FormInput
            id="name"
            type="text"
            placeholder="e.g., Coffee husks"
            disabled={isSubmitting}
            error={!!errors.name}
            autoFocus
            {...register("name")}
          />
        </FormField>
      </div>

      <FormField
        id="description"
        label="Description"
        error={errors.description?.message}
      >
        <FormTextarea
          id="description"
          placeholder="Optional description of the residue stream, sourcing context, or preparation"
          disabled={isSubmitting}
          error={!!errors.description}
          {...register("description")}
        />
      </FormField>

      <FormField
        id="registryUrl"
        label="Registry URL"
        error={errors.registryUrl?.message}
      >
        <FormInput
          id="registryUrl"
          type="url"
          placeholder="https://isometric.registry.example/feedstock/..."
          disabled={isSubmitting}
          error={!!errors.registryUrl}
          {...register("registryUrl")}
        />
      </FormField>

      <FormActions
        onCancel={onCancel}
        isSubmitting={isSubmitting}
        submitLabel={submitLabel}
        defaultSubmitLabel={isEditMode ? "Update Feedstock Type" : "Create Feedstock Type"}
      />
    </form>
  );
}
