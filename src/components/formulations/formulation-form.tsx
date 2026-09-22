/**
 * FormulationForm component
 *
 * Percent-first blend composition entry: the operator types whole percents
 * (never decimals), biochar auto-balances to the remaining share until edited
 * by hand, and a live segment bar sits directly under the share fields with one
 * key line naming every material and its share. The bar carries the unallocated
 * tail, so a blend short of 100% draws short instead of reading as full. Ratios
 * (0–1) remain the storage/server vocabulary — `percentFormToRatioPayload`
 * converts on submit, so callers keep the existing `FormulationFormData`
 * contract.
 */
"use client";

import { useEffect, useState } from "react";
import { useForm, useFieldArray, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  CompositionCard,
  FormActions,
  FormEntitySelect,
  FormField,
  FormInput,
  FormSection,
  FormTextarea,
  ResolvedErrorRevalidator,
} from "@/components/forms";
import type { MassSegment } from "@/components/forms/composition-ledger";
import { Button } from "@/components/ui";
import { SegmentBar, SegmentKey, batchAccentFill } from "@/components/ui/segment-bar";
import { useEntityOptions } from "@/hooks/use-entities";
import {
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react/dist/ssr";
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

/** Blend shares are read against each other, so they keep two decimals. */
const SHARE_FRACTION_DIGITS = 2;

/**
 * Blend shares only — the call sites below supply their own "%" and read the
 * four figures against each other, so this keeps two decimals and no suffix.
 * Not a substitute for `formatPercent` from `@/lib/format-utils`; named apart
 * from it so neither shadows the other.
 */
function formatSharePercent(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: SHARE_FRACTION_DIGITS });
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
// Blend shares, seen
// ============================================

/** Percent share formatter for the blend bar and its key line. */
function formatShareSegment(share: number | null): string {
  return `${formatSharePercent(share ?? 0)}%`;
}

/** Biochar keeps the carbon plum; the empty tail is the bar showing through. */
const UNALLOCATED_FILL = "transparent";

/**
 * One segment per entered share, in the order the operator sees the fields, plus
 * the unallocated tail so a blend that does not reach 100% draws short. Blend
 * materials are peers of each other, so the single ingredient fill would draw
 * them as one block; the entity accents keep adjacent materials apart.
 */
function blendSegments({
  biocharPercent,
  ingredients,
  unallocatedPercent,
}: {
  biocharPercent: number;
  ingredients: readonly { label: string; sharePercent: number }[];
  unallocatedPercent: number;
}): MassSegment[] {
  return [
    { label: "Biochar", mass: biocharPercent, category: "dry-biochar" },
    ...ingredients.map((ingredient, index) => ({
      label: ingredient.label,
      mass: ingredient.sharePercent,
      category: "ingredient-solids" as const,
      fill: batchAccentFill(index),
    })),
    ...(unallocatedPercent > PERCENT_DISPLAY_TOLERANCE
      ? [{
          label: "Unallocated",
          mass: unallocatedPercent,
          category: "ingredient-solids" as const,
          fill: UNALLOCATED_FILL,
        }]
      : []),
  ];
}

// ============================================
// Component
// ============================================

interface FormulationFormProps {
  formulation?: FormulationWithIngredients;
  onSubmit: (data: FormulationFormData) => Promise<void> | void;
  onCancel?: () => void;
  isSubmitting?: boolean;
  errorMessage?: string;
  submitLabel?: string;
}

export function FormulationForm({
  formulation,
  onSubmit,
  onCancel,
  isSubmitting = false,
  errorMessage,
  submitLabel,
}: FormulationFormProps) {
  const isEditMode = !!formulation;

  const {
    register,
    handleSubmit,
    control,
    trigger,
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
  const isOverAllocated = totalPercent > 100 + PERCENT_DISPLAY_TOLERANCE;
  const unallocatedPercent = isOverAllocated ? 0 : Math.max(0, 100 - totalPercent);

  // The same cached option list the blend-material selects read, so the key line
  // can name each material instead of numbering it.
  const { data: blendMaterials } = useEntityOptions({
    entityType: "feedstockType",
    filterBy: { usage: FORMULATION_LINE_FEEDSTOCK_USAGE },
    enabled: fields.length > 0,
  });
  const shareSegments = blendSegments({
    biocharPercent: biocharNum,
    ingredients: (ingredients ?? []).map((ingredient, index) => ({
      label:
        blendMaterials?.find((material) => material.id === ingredient?.feedstockTypeId)?.name
        ?? `Ingredient ${index + 1}`,
      sharePercent: watchedShareToNumber(ingredient?.sharePercent),
    })),
    unallocatedPercent,
  });
  const balanceMessage = isOverAllocated
    ? `Total ${formatSharePercent(totalPercent)}%. Reduce a share to reach 100%.`
    : isBalanced
      ? `Total ${formatSharePercent(totalPercent)}%.`
      : `Total ${formatSharePercent(totalPercent)}%. ${formatSharePercent(unallocatedPercent)}% is unallocated.`;

  const handleBalance = () => {
    setAutoBalance(true);
    setValue("biocharPercent", remainderPercent, {
      shouldDirty: true,
      shouldValidate: true,
    });
  };

  return (
    <form onSubmit={handleFormSubmit} className="space-y-20">
      <ResolvedErrorRevalidator control={control} trigger={trigger} />
      {/* Required Fields Section */}
      <FormSection title="Required information" divider={false}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="name"
            label="Formulation name"
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

      {/* Blend Composition — volume shares partition one whole */}
      <FormSection
        title="Blend composition by volume"
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
              label="Volume share (%)"
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
            No blend feedstock types are added. This is a pure-biochar formulation.
            Add a feedstock type to create a blend.
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
                  label="Blend material"
                  entityType="feedstockType"
                  placeholder="Select a blend material..."
                  disabled={isSubmitting}
                  required
                  autoSelectSingle={false}
                  allowCreate
                  createLabel="Add blend material"
                  filterBy={{ usage: FORMULATION_LINE_FEEDSTOCK_USAGE }}
                  excludeIds={(ingredients ?? [])
                    .map((ingredient, ingredientIndex) =>
                      ingredientIndex === index
                        ? undefined
                        : ingredient?.feedstockTypeId,
                    )
                    .filter((id): id is string => !!id)}
                  alwaysShowSearch
                />
              </div>

              <FormField
                id={`ingredients.${index}.sharePercent`}
                label="Volume share (%)"
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

        {/* What the entered shares make, directly under the share fields */}
        {(biocharNum > 0 || fields.length > 0) && (
          <CompositionCard
            title="Blend by volume"
            hint="Shares are percentages of the solid blend's volume. Water is recorded separately on the product."
            actions={showBalanceButton ? (
              <Button
                type="button"
                variant="default"
                size="small"
                onClick={handleBalance}
                disabled={isSubmitting}
              >
                Balance to 100%
              </Button>
            ) : undefined}
          >
            <div className="flex flex-col gap-8">
              <SegmentBar
                segments={shareSegments}
                label="Blend by volume"
                format={formatShareSegment}
              />
              <SegmentKey
                segments={shareSegments}
                format={formatShareSegment}
                className="tabular-nums"
              />
              <p
                className={`body-caption tabular-nums ${
                  isOverAllocated
                    ? "text-[var(--st-bad)]"
                    : isBalanced
                      ? "text-[var(--st-ok)]"
                      : "text-[var(--color-text-secondary)]"
                }`}
                aria-live="polite"
              >
                {balanceMessage}
              </p>
            </div>
          </CompositionCard>
        )}
      </FormSection>

      {/* Description Section */}
      <FormSection title="Additional information">
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
        control={control}
        onCancel={onCancel}
        isSubmitting={isSubmitting}
        errorMessage={errorMessage}
        submitLabel={submitLabel}
        defaultSubmitLabel={defaultSubmitLabel}
      />
    </form>
  );
}
