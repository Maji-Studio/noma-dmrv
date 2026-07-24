"use client";

import { LeafIcon } from "@phosphor-icons/react/dist/ssr";
import type { UseFormRegisterReturn } from "react-hook-form";
import { FormField, FormInput, FormSection } from "@/components/forms";
import {
  SPINE_SECTION_TAG,
  type SpineMeta,
} from "@/components/forms/form-spine";

interface NutrientFieldRegistration {
  registration: UseFormRegisterReturn;
  error?: string;
}

interface SampleNutrientFieldsProps {
  enabled: boolean;
  isSubmitting: boolean;
  enabledRegistration: UseFormRegisterReturn;
  phosphorus: NutrientFieldRegistration;
  potassium: NutrientFieldRegistration;
  magnesium: NutrientFieldRegistration;
  calcium: NutrientFieldRegistration;
  iron: NutrientFieldRegistration;
  /** Injected by FormSpine — do not set manually. */
  __spine?: SpineMeta;
}

export function SampleNutrientFields({
  enabled,
  isSubmitting,
  enabledRegistration,
  phosphorus,
  potassium,
  magnesium,
  calcium,
  iron,
  __spine,
}: SampleNutrientFieldsProps) {
  const fields = [
    { id: "phosphorusPercent", label: "Phosphorus (%)", placeholder: "e.g., 0.5", ...phosphorus },
    { id: "potassiumPercent", label: "Potassium (%)", placeholder: "e.g., 1.2", ...potassium },
    { id: "magnesiumPercent", label: "Magnesium (%)", placeholder: "e.g., 0.3", ...magnesium },
    { id: "calciumPercent", label: "Calcium (%)", placeholder: "e.g., 2.0", ...calcium },
    { id: "ironPercent", label: "Iron (%)", placeholder: "e.g., 0.1", ...iron },
  ];

  return (
    <FormSection
      title="Nutrient Claims"
      icon={<LeafIcon size={14} weight="bold" />}
      fields={fields.map((field) => field.id)}
      __spine={__spine}
    >
      <label
        htmlFor="nutrientClaimEnabled"
        className="flex cursor-pointer items-center gap-12"
      >
        <input
          type="checkbox"
          id="nutrientClaimEnabled"
          className="h-[18px] w-[18px] cursor-pointer border border-[var(--color-border-primary)] accent-[var(--clr-dark-purple)]"
          disabled={isSubmitting}
          {...enabledRegistration}
        />
        <span className="body-medium text-[var(--color-text-primary)]">
          Enable nutrient claims
        </span>
      </label>

      {enabled && (
        <div className="grid grid-cols-1 gap-x-16 gap-y-20 pt-8 sm:grid-cols-2">
          {fields.map((field) => (
            <FormField key={field.id} id={field.id} label={field.label} error={field.error}>
              <FormInput
                id={field.id}
                type="number"
                step="0.01"
                placeholder={field.placeholder}
                disabled={isSubmitting}
                error={!!field.error}
                {...field.registration}
              />
            </FormField>
          ))}
        </div>
      )}
    </FormSection>
  );
}

(SampleNutrientFields as unknown as Record<string, boolean>)[
  SPINE_SECTION_TAG
] = true;
