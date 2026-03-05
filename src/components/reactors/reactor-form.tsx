/**
 * ReactorForm component
 * Reusable reactor form with React Hook Form integration
 * Used in both create and edit slide-overs for reactors
 * Includes facility dropdown selection
 */
"use client";

import { numericValue } from "@/lib/form-utils";

import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormField, FormInput } from "@/components/forms";
import { FormSelect } from "@/components/forms/form-select";
import { EntitySelect } from "@/components/forms/entity-select";
import { Button } from "@/components/ui";
import {
  reactorFormSchema,
  reactorTypes,
  samplingMethods,
  formatReactorType,
  formatSamplingMethod,
  type ReactorFormData,
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
  /** Pre-selected facility ID (for creating reactor from facility page) */
  facilityId?: string;
  /** Form submission handler */
  onSubmit: (data: ReactorFormData) => Promise<void> | void;
  /** Cancel button handler */
  onCancel?: () => void;
  /** Whether the form is currently submitting */
  isSubmitting?: boolean;
  /** Custom label for the submit button */
  submitLabel?: string;
}

export function ReactorForm({
  reactor,
  facilityId: preselectedFacilityId,
  onSubmit,
  onCancel,
  isSubmitting = false,
  submitLabel,
}: ReactorFormProps) {
  const isEditMode = !!reactor;
  const defaultReactorType = isReactorType(reactor?.reactorType)
    ? reactor.reactorType
    : undefined;
  const defaultSamplingMethod = isSamplingMethod(reactor?.samplingMethod)
    ? reactor.samplingMethod
    : "method_a";

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(reactorFormSchema),
    defaultValues: {
      identifier: reactor?.identifier ?? "",
      facilityId: preselectedFacilityId || reactor?.facilityId || "",
      reactorType: defaultReactorType,
      samplingMethod: defaultSamplingMethod,
      capacityKg: reactor?.capacityKg ?? undefined,
      specifications: undefined,
    },
  });

  const defaultSubmitLabel = isEditMode ? "Update Reactor" : "Create Reactor";

  const handleFormSubmit = handleSubmit((data) => {
    // Cast to ReactorFormData since zodResolver validates the data
    onSubmit(data as ReactorFormData);
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
              placeholder="e.g., Reactor 001"
              disabled={isSubmitting}
              error={!!errors.identifier}
              {...register("identifier")}
            />
          </FormField>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="facilityId"
            label="Facility"
            error={errors.facilityId?.message}
            required
          >
            <Controller
              name="facilityId"
              control={control}
              render={({ field }) => (
                <EntitySelect
                  entityType="facility"
                  value={field.value}
                  onChange={field.onChange}
                  placeholder="Select a facility..."
                  disabled={isSubmitting || !!preselectedFacilityId}
                  error={!!errors.facilityId}
                  autoSelectSingle
                />
              )}
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
            id="capacityKg"
            label="Capacity (kg)"
            error={errors.capacityKg?.message}
            helperText="Production capacity in kilograms"
          >
            <FormInput
              id="capacityKg"
              type="number"
              step="any"
              placeholder="e.g., 500"
              disabled={isSubmitting}
              error={!!errors.capacityKg}
              {...register("capacityKg", {
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
