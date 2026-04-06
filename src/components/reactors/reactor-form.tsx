/**
 * ReactorForm component
 * Reusable reactor form with React Hook Form integration
 * Used in both create and edit slide-overs for reactors
 */
"use client";

import { numericValue } from "@/lib/form-utils";
import { useFacilityContext } from "@/hooks/use-facility-context";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormField, FormInput } from "@/components/forms";
import { FormSelect } from "@/components/forms/form-select";
import { Button } from "@/components/ui";
import {
  reactorFormSchema,
  reactorTypes,
  samplingMethods,
  formatReactorType,
  formatSamplingMethod,
  type ReactorFormData,
  type CreateReactorData,
  type ReactorType,
  type SamplingMethod,
} from "@/schemas/reactors";
import type { Reactor } from "@/db/schema/facilities";

// ============================================
// Constants for select options
// ============================================

const reactorTypeOptions: readonly { value: string; label: string }[] =
  reactorTypes.map((type) => ({
    value: type,
    label: formatReactorType(type),
  }));

const samplingMethodOptions: readonly { value: string; label: string }[] =
  samplingMethods.map((method) => ({
    value: method,
    label: formatSamplingMethod(method),
  }));

function isReactorType(value: string | null | undefined): value is ReactorType {
  return !!value && reactorTypes.includes(value as ReactorType);
}

function isSamplingMethod(value: string | null | undefined): value is SamplingMethod {
  return !!value && samplingMethods.includes(value as SamplingMethod);
}

// ============================================
// Component
// ============================================

interface ReactorFormProps {
  /** Existing reactor data for editing (undefined for create mode) */
  reactor?: Reactor;
  /** Form submission handler — receives data with nominalThroughputTph */
  onSubmit: (data: CreateReactorData) => Promise<void> | void;
  /** Cancel button handler */
  onCancel?: () => void;
  /** Whether the form is currently submitting */
  isSubmitting?: boolean;
  /** Custom label for the submit button */
  submitLabel?: string;
}

export function ReactorForm({
  reactor,
  onSubmit,
  onCancel,
  isSubmitting = false,
  submitLabel,
}: ReactorFormProps) {
  const isEditMode = !!reactor;
  const { facilityId: contextFacilityId } = useFacilityContext();
  const defaultReactorType = isReactorType(reactor?.reactorType)
    ? reactor.reactorType
    : undefined;
  const defaultSamplingMethod = isSamplingMethod(reactor?.samplingMethod)
    ? reactor.samplingMethod
    : "method_a";

  const {
    register,
    handleSubmit,
    getValues,
    setValue,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(reactorFormSchema),
    defaultValues: {
      identifier: reactor?.identifier ?? "",
      facilityId: reactor?.facilityId || contextFacilityId || "",
      reactorType: defaultReactorType,
      samplingMethod: defaultSamplingMethod,
      capacityTph: reactor?.nominalThroughputTph ?? undefined,
      specifications: undefined,
    },
  });

  useEffect(() => {
    if (!reactor?.facilityId && contextFacilityId) {
      const currentFacilityId = getValues("facilityId");
      if (!currentFacilityId) {
        setValue("facilityId", contextFacilityId);
      }
    }
  }, [contextFacilityId, reactor?.facilityId, setValue, getValues]);

  const defaultSubmitLabel = isEditMode ? "Update Reactor" : "Create Reactor";

  const handleFormSubmit = handleSubmit((data) => {
    const { capacityTph, ...rest } = data as ReactorFormData;
    onSubmit({
      ...rest,
      nominalThroughputTph: capacityTph ?? undefined,
    });
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

      </div>

      {/* Reactor Configuration Section */}
      <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Reactor Configuration
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="reactorType"
            label="Reactor Type"
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

        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="samplingMethod"
            label="Sampling Method"
            error={errors.samplingMethod?.message}
            helperText="Method B requires 30 prior Method A samples"
          >
            <FormSelect
              id="samplingMethod"
              disabled={isSubmitting}
              error={!!errors.samplingMethod}
              options={samplingMethodOptions}
              {...register("samplingMethod")}
            />
          </FormField>

          <FormField
            id="capacityTph"
            label="Nominal Throughput (tph)"
            error={errors.capacityTph?.message}
            helperText="Designed feedstock throughput per hour"
          >
            <FormInput
              id="capacityTph"
              type="number"
              step="any"
              placeholder="e.g., 3"
              disabled={isSubmitting}
              error={!!errors.capacityTph}
              {...register("capacityTph", {
                setValueAs: numericValue,
              })}
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
