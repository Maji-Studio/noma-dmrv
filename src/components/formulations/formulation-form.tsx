/**
 * FormulationForm component
 * Reusable formulation form with React Hook Form integration
 * Supports dynamic ingredient rows via useFieldArray
 */
"use client";

import { nullableNumericValue } from "@/lib/form-utils";
import { useForm, useFieldArray, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormEntitySelect, FormField, FormInput, FormTextarea, FormSection, FormActions } from "@/components/forms";
import { Button } from "@/components/ui";
import { PlusIcon, TrashIcon } from "@phosphor-icons/react";
import {
  formulationFormSchema,
  formulationRatioSum,
  exceedsFormulationRatioSum,
  RATIO_SUM_MAX,
  FORMULATION_LINE_FEEDSTOCK_USAGE,
  type FormulationFormData,
} from "@/schemas/formulations";
import type { FormulationWithIngredients } from "@/data-access/formulations";

const EMPTY_INGREDIENT = {
  feedstockTypeId: "",
  ratio: null,
};

/** Tolerance for the "sums to exactly 100%" green display state. */
const RATIO_DISPLAY_TOLERANCE = 0.001;

// ============================================
// Component
// ============================================

interface FormulationFormProps {
  formulation?: FormulationWithIngredients;
  onSubmit: (data: FormulationFormData) => Promise<void> | void;
  onCancel?: () => void;
  isSubmitting?: boolean;
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
    control,
    formState: { errors },
  } = useForm<FormulationFormData>({
    resolver: zodResolver(formulationFormSchema),
    defaultValues: {
      name: formulation?.name ?? "",
      biocharRatio: formulation?.biocharRatio ?? null,
      description: formulation?.description ?? "",
      ingredients: formulation?.ingredients?.map((ing) => ({
        feedstockTypeId: ing.feedstockTypeId,
        ratio: ing.ratio ?? null,
      })) ?? [],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "ingredients",
  });

  const defaultSubmitLabel = isEditMode ? "Update Formulation" : "Create Formulation";

  const handleFormSubmit = handleSubmit((data) => {
    return onSubmit(data as FormulationFormData);
  });

  // Watch ratios for the live total-ratio indicator
  const biocharRatio = useWatch({ control, name: "biocharRatio" });
  const ingredients = useWatch({ control, name: "ingredients" });
  const totalRatio = formulationRatioSum(biocharRatio, ingredients);
  const ratioSumExceeded = exceedsFormulationRatioSum(biocharRatio, ingredients);
  const ratioSumAtTarget =
    Math.abs(totalRatio - RATIO_SUM_MAX) < RATIO_DISPLAY_TOLERANCE;

  return (
    <form onSubmit={handleFormSubmit} className="space-y-20">
      {/* Required Fields Section */}
      <FormSection title="Required Information" divider={false}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="name"
            label="Formulation Name"
            error={errors.name?.message}
            required
          >
            <FormInput
              id="name"
              type="text"
              placeholder="e.g., Soil Amendment Blend"
              disabled={isSubmitting}
              error={!!errors.name}
              {...register("name")}
            />
          </FormField>
        </div>
      </FormSection>

      {/* Biochar Ratio Section */}
      <FormSection title="Biochar Ratio">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="biocharRatio"
            label="Biochar Ratio (0–1)"
            error={errors.biocharRatio?.message}
            helperText="Value between 0 and 1 (e.g., 0.7 displays as 70%)"
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
              {...register("biocharRatio", { setValueAs: nullableNumericValue })}
            />
          </FormField>
        </div>
      </FormSection>

      {/* Ingredients Section */}
      <FormSection
        title="Ingredients"
        actions={
          <Button
            type="button"
            variant="default"
            size="small"
            onClick={() => append(EMPTY_INGREDIENT)}
            disabled={isSubmitting}
          >
            <PlusIcon size={16} weight="bold" />
            Add Ingredient
          </Button>
        }
      >
        {fields.length === 0 && (
          <p className="body-small text-[var(--color-text-tertiary)] py-8">
            No ingredients added. Click &quot;Add Ingredient&quot; to add amendment components.
          </p>
        )}

        {fields.map((field, index) => (
          <div
            key={field.id}
            className="border border-[var(--color-border-tertiary)] p-16 space-y-12"
          >
            <div className="flex items-center justify-between">
              <span className="body-small font-medium text-[var(--color-text-secondary)]">
                Ingredient {index + 1}
              </span>
              <Button
                variant="destructive"
                size="small"
                onClick={() => remove(index)}
                disabled={isSubmitting}
                aria-label={`Remove ingredient ${index + 1}`}
              >
                <TrashIcon size={16} weight="bold" />
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-x-12 gap-y-12">
              <div className="md:col-span-2">
                <FormEntitySelect
                  control={control}
                  name={`ingredients.${index}.feedstockTypeId`}
                  label="Blend Material"
                  entityType="feedstockType"
                  placeholder="Select a blend material..."
                  disabled={isSubmitting}
                  required
                  autoSelectSingle={false}
                  allowCreate
                  createLabel="Add blend material"
                  filterBy={{ usage: FORMULATION_LINE_FEEDSTOCK_USAGE }}
                  alwaysShowSearch
                />
              </div>

              <FormField
                id={`ingredients.${index}.ratio`}
                label="Ratio"
                error={errors.ingredients?.[index]?.ratio?.message}
              >
                <FormInput
                  id={`ingredients.${index}.ratio`}
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                  placeholder="e.g., 0.3"
                  disabled={isSubmitting}
                  error={!!errors.ingredients?.[index]?.ratio}
                  {...register(`ingredients.${index}.ratio`, {
                    setValueAs: nullableNumericValue,
                  })}
                />
              </FormField>
            </div>
          </div>
        ))}

        {/* Ratio Sum Indicator */}
        {(biocharRatio != null || fields.length > 0) && (
          <div
            className={`body-small px-12 py-8 border ${
              ratioSumAtTarget
                ? "border-[var(--color-signal-green)] text-[var(--color-signal-green)] bg-[var(--color-signal-green)]/5"
                : ratioSumExceeded
                  ? "border-[var(--color-signal-red)] text-[var(--color-signal-red)] bg-[var(--color-signal-red)]/5"
                  : "border-[var(--color-border-tertiary)] text-[var(--color-text-secondary)]"
            }`}
          >
            Total ratio: {(totalRatio * 100).toFixed(0)}%
            {ratioSumExceeded && (
              <span className="ml-8">
                — exceeds 100%, reduce ratios before saving
              </span>
            )}
            {!ratioSumExceeded && !ratioSumAtTarget && totalRatio > 0 && (
              <span className="ml-8">(does not sum to 100%)</span>
            )}
          </div>
        )}
      </FormSection>

      {/* Description Section */}
      <FormSection title="Additional Information">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <div className="md:col-span-2">
            <FormField
              id="description"
              label="Description"
              error={errors.description?.message}
            >
              <FormTextarea
                id="description"
                placeholder="Describe the biochar blend, target use case, and any agronomic or product notes."
                disabled={isSubmitting}
                error={!!errors.description}
                {...register("description")}
              />
            </FormField>
          </div>
        </div>
      </FormSection>

      <FormActions
        onCancel={onCancel}
        isSubmitting={isSubmitting}
        submitLabel={submitLabel}
        defaultSubmitLabel={defaultSubmitLabel}
      />
    </form>
  );
}
