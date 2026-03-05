/**
 * FormulationForm component
 * Reusable formulation form with React Hook Form integration
 * Supports dynamic ingredient rows via useFieldArray
 */
"use client";

import { nullableNumericValue } from "@/lib/form-utils";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormField, FormInput, FormTextarea, FormSelect } from "@/components/forms";
import { Button } from "@/components/ui";
import { Plus, Trash } from "@phosphor-icons/react";
import {
  formulationFormSchema,
  INGREDIENT_TYPES,
  INGREDIENT_TYPE_LABELS,
  type FormulationFormData,
} from "@/schemas/formulations";
import type { FormulationWithIngredients } from "@/data-access/formulations";

// ============================================
// Constants
// ============================================

const INGREDIENT_TYPE_OPTIONS = INGREDIENT_TYPES.map((type) => ({
  value: type,
  label: INGREDIENT_TYPE_LABELS[type],
}));

const EMPTY_INGREDIENT = {
  ingredientType: "compost" as const,
  name: "",
  ratio: null,
  description: "",
};

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
    watch,
    formState: { errors },
  } = useForm<FormulationFormData>({
    resolver: zodResolver(formulationFormSchema),
    defaultValues: {
      name: formulation?.name ?? "",
      biocharRatio: formulation?.biocharRatio ?? null,
      description: formulation?.description ?? "",
      ingredients: formulation?.ingredients?.map((ing) => ({
        ingredientType: ing.ingredientType,
        name: ing.name,
        ratio: ing.ratio ?? null,
        description: ing.description ?? "",
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

  // Watch ratios for sum display
  const biocharRatio = watch("biocharRatio");
  const ingredients = watch("ingredients");
  const ingredientRatioSum = (ingredients ?? []).reduce(
    (sum, ing) => sum + (ing?.ratio ?? 0),
    0
  );
  const totalRatio = (biocharRatio ?? 0) + ingredientRatioSum;

  return (
    <form onSubmit={handleFormSubmit} className="space-y-20">
      {/* Required Fields Section */}
      <div className="space-y-20">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Required Information
        </h3>

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
              placeholder="e.g., Raw Biochar"
              disabled={isSubmitting}
              error={!!errors.name}
              {...register("name")}
            />
          </FormField>
        </div>
      </div>

      {/* Biochar Ratio Section */}
      <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Biochar Ratio
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="biocharRatio"
            label="Biochar Ratio"
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
              {...register("biocharRatio", { setValueAs: nullableNumericValue })}
            />
          </FormField>
        </div>
      </div>

      {/* Ingredients Section */}
      <div className="space-y-16 pt-20 border-t border-[var(--color-border-tertiary)]">
        <div className="flex items-center justify-between">
          <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
            Ingredients
          </h3>
          <Button
            type="button"
            variant="default"
            size="small"
            onClick={() => append(EMPTY_INGREDIENT)}
            disabled={isSubmitting}
          >
            <Plus size={16} weight="bold" />
            Add Ingredient
          </Button>
        </div>

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
              <button
                type="button"
                onClick={() => remove(index)}
                disabled={isSubmitting}
                aria-label={`Remove ingredient ${index + 1}`}
                className="h-28 w-28 flex items-center justify-center text-[var(--color-signal-red)] hover:bg-[var(--color-signal-red)]/10 transition-colors"
              >
                <Trash size={16} weight="bold" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-x-12 gap-y-12">
              <FormField
                id={`ingredients.${index}.ingredientType`}
                label="Type"
                error={errors.ingredients?.[index]?.ingredientType?.message}
                required
              >
                <FormSelect
                  id={`ingredients.${index}.ingredientType`}
                  options={INGREDIENT_TYPE_OPTIONS}
                  disabled={isSubmitting}
                  error={!!errors.ingredients?.[index]?.ingredientType}
                  {...register(`ingredients.${index}.ingredientType`)}
                />
              </FormField>

              <FormField
                id={`ingredients.${index}.name`}
                label="Name"
                error={errors.ingredients?.[index]?.name?.message}
                required
              >
                <FormInput
                  id={`ingredients.${index}.name`}
                  type="text"
                  placeholder="e.g., Cow manure compost"
                  disabled={isSubmitting}
                  error={!!errors.ingredients?.[index]?.name}
                  {...register(`ingredients.${index}.name`)}
                />
              </FormField>

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

            <FormField
              id={`ingredients.${index}.description`}
              label="Description"
              error={errors.ingredients?.[index]?.description?.message}
            >
              <FormInput
                id={`ingredients.${index}.description`}
                type="text"
                placeholder="Optional notes about this ingredient"
                disabled={isSubmitting}
                error={!!errors.ingredients?.[index]?.description}
                {...register(`ingredients.${index}.description`)}
              />
            </FormField>
          </div>
        ))}

        {/* Ratio Sum Indicator */}
        {(biocharRatio != null || fields.length > 0) && (
          <div
            className={`body-small px-12 py-8 border ${
              Math.abs(totalRatio - 1) < 0.001
                ? "border-[var(--color-signal-green)] text-[var(--color-signal-green)] bg-[var(--color-signal-green)]/5"
                : totalRatio > 1
                  ? "border-[var(--color-signal-red)] text-[var(--color-signal-red)] bg-[var(--color-signal-red)]/5"
                  : "border-[var(--color-border-tertiary)] text-[var(--color-text-secondary)]"
            }`}
          >
            Total ratio: {(totalRatio * 100).toFixed(0)}%
            {Math.abs(totalRatio - 1) >= 0.001 && totalRatio > 0 && (
              <span className="ml-8">
                {totalRatio > 1 ? "(exceeds 100%)" : "(does not sum to 100%)"}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Description Section */}
      <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Additional Information
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="description"
            label="Description"
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
