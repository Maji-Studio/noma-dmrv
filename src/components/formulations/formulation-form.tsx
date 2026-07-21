/**
 * FormulationForm component
 *
 * Percent-first blend composition entry: the operator types whole percents
 * (never decimals), biochar auto-balances to the remaining share until edited
 * by hand, and a live allocation bar shows how the blend partitions. Ratios
 * (0–1) remain the storage/server vocabulary — `percentFormToRatioPayload`
 * converts on submit, so callers keep the existing `FormulationFormData`
 * contract.
 */
"use client";

import { useEffect, useState } from "react";
import { useForm, useFieldArray, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormEntitySelect, FormField, FormInput, FormTextarea, FormSection, FormActions } from "@/components/forms";
import { Button } from "@/components/ui";
import { PlusIcon, TrashIcon } from "@phosphor-icons/react";
import {
  formulationPercentFormSchema,
  percentFormToRatioPayload,
  ratioToPercent,
  FORMULATION_LINE_FEEDSTOCK_USAGE,
  PERCENT_DECIMALS,
  type FormulationFormData,
  type FormulationPercentFormData,
} from "@/schemas/formulations";
import type { FormulationWithIngredients } from "@/data-access/formulations";

const EMPTY_INGREDIENT = {
  feedstockTypeId: "",
  sharePercent: null,
};

/** Display tolerance (in percent) for the "fully allocated" state. */
const PERCENT_DISPLAY_TOLERANCE = 0.1;

/**
 * Shares keep the converters' 4-decimal percent precision (`PERCENT_DECIMALS`).
 * The input `step` must match, or a stored value like 33.3333 trips native
 * step-mismatch validation and blocks submit; auto-balance rounds to the same
 * precision so the balanced sum stays a valid 100%.
 */
const SHARE_PERCENT_STEP = String(1 / PERCENT_DECIMALS);

/** A fresh formulation starts as pure biochar; adding ingredients rebalances. */
const DEFAULT_BIOCHAR_PERCENT = 100;

function formatPercent(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/**
 * Raw share inputs hold strings until the schema coerces on submit — the live
 * bar and auto-balance must parse them the same way (`""`/invalid → 0).
 */
function watchedShareToNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

// ============================================
// Allocation Bar
// ============================================

function AllocationBar({
  biocharPercent,
  ingredientPercent,
}: {
  biocharPercent: number;
  ingredientPercent: number;
}) {
  const total = biocharPercent + ingredientPercent;
  const isOver = total > 100 + PERCENT_DISPLAY_TOLERANCE;
  const isFull = !isOver && Math.abs(total - 100) <= PERCENT_DISPLAY_TOLERANCE;
  const unallocated = isOver || isFull ? 0 : 100 - total;

  // When over-allocated the segments scale to fill the bar; the border and
  // total flip to the error tone instead of drawing a fake >100% width.
  const scale = isOver ? 100 / total : 1;

  return (
    <div className="space-y-8">
      <div
        className={`flex h-8 w-full overflow-hidden border ${
          isOver
            ? "border-[var(--st-bad)]"
            : "border-[var(--color-border-tertiary)]"
        }`}
        role="img"
        aria-label={`Blend allocation: biochar ${formatPercent(biocharPercent)}%, ingredients ${formatPercent(ingredientPercent)}%, unallocated ${formatPercent(unallocated)}%`}
      >
        {biocharPercent > 0 && (
          <div
            className="h-full bg-[var(--acc-prod)]"
            style={{ width: `${biocharPercent * scale}%` }}
          />
        )}
        {ingredientPercent > 0 && (
          <div
            className="h-full bg-[var(--acc-infra)]"
            style={{ width: `${ingredientPercent * scale}%` }}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-16 gap-y-4">
        <span className="body-caption text-[var(--color-text-secondary)] inline-flex items-center gap-6">
          <span aria-hidden className="inline-block w-8 h-8 bg-[var(--acc-prod)]" />
          Biochar {formatPercent(biocharPercent)}%
        </span>
        <span className="body-caption text-[var(--color-text-secondary)] inline-flex items-center gap-6">
          <span aria-hidden className="inline-block w-8 h-8 bg-[var(--acc-infra)]" />
          Ingredients {formatPercent(ingredientPercent)}%
        </span>
        {unallocated > PERCENT_DISPLAY_TOLERANCE && (
          <span className="body-caption text-[var(--color-text-tertiary)] inline-flex items-center gap-6">
            <span aria-hidden className="inline-block w-8 h-8 border border-[var(--color-border-tertiary)]" />
            Unallocated {formatPercent(unallocated)}%
          </span>
        )}
        <span
          className={`body-caption ml-auto font-medium ${
            isOver
              ? "text-[var(--st-bad)]"
              : isFull
                ? "text-[var(--st-ok)]"
                : "text-[var(--color-text-secondary)]"
          }`}
        >
          Total {formatPercent(total)}%
          {isOver && " — exceeds 100%"}
        </span>
      </div>
    </div>
  );
}

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
    setValue,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(formulationPercentFormSchema),
    defaultValues: {
      name: formulation?.name ?? "",
      biocharPercent: isEditMode
        ? ratioToPercent(formulation?.biocharRatio)
        : DEFAULT_BIOCHAR_PERCENT,
      description: formulation?.description ?? "",
      ingredients: formulation?.ingredients?.map((ing) => ({
        feedstockTypeId: ing.feedstockTypeId,
        sharePercent: ratioToPercent(ing.ratio),
      })) ?? [],
    },
  });

  // Cast control for FormEntitySelect compatibility (z.preprocess makes input types `unknown`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const formControl = control as any;

  const { fields, append, remove } = useFieldArray({
    control,
    name: "ingredients",
  });

  const defaultSubmitLabel = isEditMode ? "Update Formulation" : "Create Formulation";

  const handleFormSubmit = handleSubmit((data) => {
    return onSubmit(percentFormToRatioPayload(data as FormulationPercentFormData));
  });

  // Watch shares for auto-balance, the allocation bar, and the total.
  const biocharPercent = useWatch({ control, name: "biocharPercent" });
  const ingredients = useWatch({ control, name: "ingredients" });
  const biocharNum = watchedShareToNumber(biocharPercent);
  const ingredientSum = (ingredients ?? []).reduce(
    (sum, ingredient) => sum + watchedShareToNumber(ingredient?.sharePercent),
    0,
  );
  const totalPercent = biocharNum + ingredientSum;
  const remainderPercent = Math.max(
    0,
    Math.round((100 - ingredientSum) * PERCENT_DECIMALS) / PERCENT_DECIMALS,
  );

  // Biochar auto-balances to the remaining share until the operator edits it
  // by hand (typing in the field switches to manual; "Balance to 100%"
  // switches back). Edit mode starts manual so saved shares are respected.
  const [autoBalance, setAutoBalance] = useState(!isEditMode);
  useEffect(() => {
    if (!autoBalance) return;
    setValue("biocharPercent", remainderPercent, {
      shouldDirty: false,
      shouldValidate: false,
    });
  }, [autoBalance, remainderPercent, setValue]);

  const isBalanced = Math.abs(totalPercent - 100) <= PERCENT_DISPLAY_TOLERANCE;
  const showBalanceButton = !isBalanced && ingredientSum <= 100;

  const handleBalance = () => {
    setAutoBalance(true);
    setValue("biocharPercent", remainderPercent, {
      shouldDirty: true,
      shouldValidate: true,
    });
  };

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

      {/* Blend Composition — biochar and ingredients partition one whole */}
      <FormSection
        title="Blend Composition"
        hint="Shares are percentages of the solid blend. Water is tracked on the product, so the total may stay under 100%."
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
        {/* Biochar row — the base material, styled like an ingredient row */}
        <div className="border border-[var(--color-border-tertiary)] p-16 space-y-12">
          <div className="flex items-center justify-between">
            <span className="body-small font-medium text-[var(--color-text-secondary)]">
              Biochar
            </span>
            <span className="body-caption text-[var(--color-text-tertiary)]">
              Base material
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-x-12 gap-y-12">
            <p className="md:col-span-2 body-small text-[var(--color-text-tertiary)] self-center">
              Pyrolyzed carbon from your production runs.
            </p>
            <FormField
              id="biocharPercent"
              label="Share (%)"
              error={errors.biocharPercent?.message}
              helperText={
                autoBalance ? "Auto-fills the remaining share" : undefined
              }
            >
              <FormInput
                id="biocharPercent"
                type="number"
                step={SHARE_PERCENT_STEP}
                min="0"
                max="100"
                placeholder="e.g., 70"
                disabled={isSubmitting}
                error={!!errors.biocharPercent}
                {...register("biocharPercent", {
                  onChange: () => {
                    setAutoBalance(false);
                  },
                })}
              />
            </FormField>
          </div>
        </div>

        {fields.length === 0 && (
          <p className="body-small text-[var(--color-text-tertiary)] py-8">
            No ingredients added — this is a pure-biochar formulation. Click
            &quot;Add Ingredient&quot; to blend in amendment components.
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
                  control={formControl}
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
                id={`ingredients.${index}.sharePercent`}
                label="Share (%)"
                error={errors.ingredients?.[index]?.sharePercent?.message}
              >
                <FormInput
                  id={`ingredients.${index}.sharePercent`}
                  type="number"
                  step={SHARE_PERCENT_STEP}
                  min="0"
                  max="100"
                  placeholder="e.g., 30"
                  disabled={isSubmitting}
                  error={!!errors.ingredients?.[index]?.sharePercent}
                  {...register(`ingredients.${index}.sharePercent`)}
                />
              </FormField>
            </div>
          </div>
        ))}

        {/* Live allocation overview */}
        {(biocharNum > 0 || fields.length > 0) && (
          <div className="space-y-8">
            <AllocationBar
              biocharPercent={biocharNum}
              ingredientPercent={ingredientSum}
            />
            {showBalanceButton && (
              <Button
                type="button"
                variant="default"
                size="small"
                onClick={handleBalance}
                disabled={isSubmitting}
              >
                Balance to 100%
              </Button>
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
