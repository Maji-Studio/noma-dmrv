/**
 * ReactorForm component
 * Reusable reactor form with React Hook Form integration
 * Used in both create and edit slide-overs for reactors
 *
 * NOTE (ADR 0022): sampling is an immutable credit-batch choice, not a reactor
 * property. The picker and Method-B validation therefore do not belong here.
 */
"use client";

import { useLatchedSubmit } from "@/hooks/use-latched-submit";
import { nullableNumericValue } from "@/lib/form-utils";
import { useFacilityContext } from "@/hooks/use-facility-context";

import { useEffect, useId } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useSaveRefusal, type SaveRefusalHandler } from "@/components/forms/use-save-refusal";
import { FormField, FormInput, FormActions, FormSection } from "@/components/forms";
import { FormSelect } from "@/components/forms/form-select";
import {
  reactorFormSchema,
  reactorTypes,
  formatReactorType,
  type ReactorFormData,
  type CreateReactorData,
  type ReactorType,
} from "@/schemas/reactors";
import type { Reactor } from "@/db/schema/facilities";
import { numberInputConstraintsFor } from "@/lib/number-input-constraints";

/** Native min, max and step for each number input, read from the schema. */
const numberBounds = numberInputConstraintsFor(reactorFormSchema);

/** Server payload name to form field, where they differ. */
const REFUSAL_ALIASES = { nominalThroughputTph: "capacityTph" } as const;

// ============================================
// Constants for select options
// ============================================

const reactorTypeOptions: readonly { value: string; label: string }[] =
  reactorTypes.map((type) => ({
    value: type,
    label: formatReactorType(type),
  }));

function isReactorType(value: string | null | undefined): value is ReactorType {
  return !!value && reactorTypes.includes(value as ReactorType);
}

// ============================================
// Component
// ============================================

interface ReactorFormProps {
  /** Existing reactor data for editing (undefined for create mode) */
  reactor?: Reactor;
  /** Form submission handler — receives data with nominalThroughputTph */
  /** `onRefusal` shows a refused save at the fields it names (#1327). */
  onSubmit: (data: CreateReactorData, onRefusal: SaveRefusalHandler) => Promise<void> | void;
  /** Cancel button handler */
  onCancel?: () => void;
  /** Whether the form is currently submitting */
  isSubmitting?: boolean;
  /** Submission-level error shown with the action footer */
  errorMessage?: string;
  /** Custom label for the submit button */
  submitLabel?: string;
  /** Custom label for the secondary action */
  cancelLabel?: string;
}

export function ReactorForm({
  reactor,
  onSubmit,
  onCancel,
  isSubmitting = false,
  errorMessage,
  submitLabel,
  cancelLabel,
}: ReactorFormProps) {
  const latched = useLatchedSubmit();
  const formId = useId();
  const isEditMode = !!reactor;
  const { facilityId: contextFacilityId } = useFacilityContext();
  const defaultReactorType = isReactorType(reactor?.reactorType)
    ? reactor.reactorType
    : undefined;

  const {
    control,
    register,
    handleSubmit,
    getValues,
    setValue,
    setError,
    resetField,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(reactorFormSchema),
    defaultValues: {
      identifier: reactor?.identifier ?? "",
      facilityId: reactor?.facilityId || contextFacilityId || "",
      reactorType: defaultReactorType,
      capacityTph: reactor?.nominalThroughputTph ?? undefined,
      specifications: undefined,
    },
  });

  const refuseSave = useSaveRefusal({ control, setError, resetField, formId, aliases: REFUSAL_ALIASES });

  useEffect(() => {
    if (!reactor?.facilityId && contextFacilityId) {
      const currentFacilityId = getValues("facilityId");
      if (!currentFacilityId) {
        setValue("facilityId", contextFacilityId);
      }
    }
  }, [contextFacilityId, reactor?.facilityId, setValue, getValues]);

  const defaultSubmitLabel = isEditMode ? "Update reactor" : "Create reactor";

  const handleFormSubmit = latched(handleSubmit((data) => {
    const { capacityTph, ...rest } = data as ReactorFormData;
    return onSubmit({
      ...rest,
      nominalThroughputTph: capacityTph ?? null,
    }, refuseSave);
  }));

  return (
    <form id={formId} onSubmit={handleFormSubmit} className="space-y-20">
      <FormSection divider={false}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="identifier"
            label="Identifier"
            error={errors.identifier?.message}
            required
          >
            <FormInput
              id="identifier"
              type="text"
              placeholder="e.g., Rotary Kiln 01"
              disabled={isSubmitting}
              error={!!errors.identifier}
              {...register("identifier")}
            />
          </FormField>
        </div>

      </FormSection>

      {/* Reactor Configuration Section */}
      <FormSection title="Reactor configuration">
        <div className="grid grid-cols-1 gap-x-16 gap-y-20">
          <FormField
            id="reactorType"
            label="Reactor type"
            error={errors.reactorType?.message}
            required
          >
            <FormSelect
              id="reactorType"
              placeholder="Select reactor type..."
              disabled={isSubmitting}
              error={!!errors.reactorType}
              options={reactorTypeOptions}
              {...register("reactorType")}
            />
          </FormField>

          <FormField
            id="capacityTph"
            label="Nominal throughput (tph)"
            error={errors.capacityTph?.message}
            helperText="Designed feedstock throughput per hour"
          >
            <FormInput
              id="capacityTph"
              type="number"
              {...numberBounds("capacityTph")}
              placeholder="e.g., 3"
              disabled={isSubmitting}
              error={!!errors.capacityTph}
              {...register("capacityTph", {
                setValueAs: nullableNumericValue,
              })}
            />
          </FormField>
        </div>
      </FormSection>

      <FormActions
        control={control}
        onCancel={onCancel}
        isSubmitting={isSubmitting}
        errorMessage={errorMessage}
        submitLabel={submitLabel}
        defaultSubmitLabel={defaultSubmitLabel}
        cancelLabel={cancelLabel}
      />
    </form>
  );
}
