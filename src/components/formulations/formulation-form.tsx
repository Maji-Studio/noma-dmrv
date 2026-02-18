/**
 * FormulationForm component
 * Reusable formulation form with React Hook Form integration
 * Used in both create and edit views for formulations
 */
"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormField, FormInput, FormTextarea } from "@/components/forms";
import { Button } from "@/components/ui";
import {
  formulationFormSchema,
  type FormulationFormData,
} from "@/schemas/formulations";
import type { Formulation } from "@/db/schema";

// ============================================
// Component
// ============================================

interface FormulationFormProps {
  /** Existing formulation data for editing (undefined for create mode) */
  formulation?: Formulation;
  /** Form submission handler */
  onSubmit: (data: FormulationFormData) => Promise<void> | void;
  /** Cancel button handler */
  onCancel?: () => void;
  /** Whether the form is currently submitting */
  isSubmitting?: boolean;
  /** Custom label for the submit button */
  submitLabel?: string;
}

export function FormulationForm({
  formulation,
  onSubmit,
  onCancel,
  isSubmitting = false,
  submitLabel,
}: FormulationFormProps) {
  const isEditMode = !!formulation;

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(formulationFormSchema),
    defaultValues: {
      code: formulation?.code ?? "",
      name: formulation?.name ?? "",
      biocharRatio: formulation?.biocharRatio ?? null,
      compostRatio: formulation?.compostRatio ?? null,
      description: formulation?.description ?? "",
    },
  });

  const defaultSubmitLabel = isEditMode ? "Update Formulation" : "Create Formulation";

  const handleFormSubmit = handleSubmit((data) => {
    onSubmit(data as FormulationFormData);
  });

  return (
    <form onSubmit={handleFormSubmit} className="space-y-20">
      {/* Required Fields Section */}
      <div className="space-y-20">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Required Information
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="code"
            label="Formulation Code"
            error={errors.code?.message}
          >
            <FormInput
              id="code"
              type="text"
              placeholder="Auto-generated if empty"
              disabled={isSubmitting}
              error={!!errors.code}
              {...register("code")}
            />
          </FormField>

          <FormField
            id="name"
            label="Formulation Name"
            error={errors.name?.message}
          >
            <FormInput
              id="name"
              type="text"
              placeholder="e.g., Raw Biochar"
              disabled={isSubmitting}
              error={!!errors.name}
              {...register("name")}
            />
          </FormField>
        </div>
      </div>

      {/* Composition Ratios Section */}
      <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Composition Ratios
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="biocharRatio"
            label="Biochar Ratio (optional)"
            error={errors.biocharRatio?.message}
            helperText="Value between 0 and 1 (e.g., 0.7 for 70%)"
          >
            <FormInput
              id="biocharRatio"
              type="number"
              step="0.01"
              min="0"
              max="1"
              placeholder="e.g., 0.7"
              disabled={isSubmitting}
              error={!!errors.biocharRatio}
              {...register("biocharRatio", { valueAsNumber: true })}
            />
          </FormField>

          <FormField
            id="compostRatio"
            label="Compost Ratio (optional)"
            error={errors.compostRatio?.message}
            helperText="Value between 0 and 1 (e.g., 0.3 for 30%)"
          >
            <FormInput
              id="compostRatio"
              type="number"
              step="0.01"
              min="0"
              max="1"
              placeholder="e.g., 0.3"
              disabled={isSubmitting}
              error={!!errors.compostRatio}
              {...register("compostRatio", { valueAsNumber: true })}
            />
          </FormField>
        </div>
      </div>

      {/* Description Section */}
      <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Additional Information
        </h3>

        <FormField
          id="description"
          label="Description (optional)"
          error={errors.description?.message}
        >
          <FormTextarea
            id="description"
            placeholder="Enter a description for this formulation..."
            disabled={isSubmitting}
            error={!!errors.description}
            {...register("description")}
          />
        </FormField>
      </div>

      {/* Form Actions */}
      <div className="flex items-center justify-end gap-16 pt-20 border-t border-[var(--color-border-secondary)]">
        {onCancel && (
          <Button
            type="button"
            variant="default"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
        )}
        <Button type="submit" variant="primary" disabled={isSubmitting}>
          {isSubmitting ? "Saving..." : submitLabel ?? defaultSubmitLabel}
        </Button>
      </div>
    </form>
  );
}
