/**
 * ProductionRunForm component
 * Reusable production run form with React Hook Form integration
 * Uses bin-based feedstock selection with proportional allocation
 */
"use client";

import { numericValue, nullableNumericValue, integerValue } from "@/lib/form-utils";
import { formatLocalDate, formatLocalDateTime } from "@/lib/date-utils";

import { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormField, FormInput } from "@/components/forms";
import { FormSelect } from "@/components/forms/form-select";
import { EntitySelect } from "@/components/forms/entity-select";
import { Button } from "@/components/ui";
import {
  productionRunFormSchema,
  productionRunStatuses,
  formatProductionRunStatus,
  type ProductionRunFormData,
  type ProductionRunStatus,
} from "@/schemas/production-runs";
import type { ProductionRunWithRelations } from "@/data-access/production-runs";

// ============================================
// Constants for select options
// ============================================

const statusOptions: readonly { value: string; label: string }[] =
  productionRunStatuses.map((status) => ({
    value: status,
    label: formatProductionRunStatus(status),
  }));

// ============================================
// Component
// ============================================

interface ProductionRunFormProps {
  /** Existing production run data for editing (undefined for create mode) */
  productionRun?: ProductionRunWithRelations;
  /** Pre-selected facility ID */
  facilityId?: string;
  /** Form submission handler */
  onSubmit: (data: ProductionRunFormData) => Promise<void> | void;
  /** Cancel button handler */
  onCancel?: () => void;
  /** Whether the form is currently submitting */
  isSubmitting?: boolean;
  /** Custom label for the submit button */
  submitLabel?: string;
}

export function ProductionRunForm({
  productionRun,
  facilityId: preselectedFacilityId,
  onSubmit,
  onCancel,
  isSubmitting = false,
  submitLabel,
}: ProductionRunFormProps) {
  const isEditMode = !!productionRun;

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(productionRunFormSchema),
    defaultValues: {
      facilityId: preselectedFacilityId || productionRun?.facilityId || "",
      date: productionRun?.date ?? formatLocalDate(new Date()),
      reactorId: productionRun?.reactorId ?? "",
      status: (productionRun?.status as ProductionRunStatus) ?? "draft",
      startTime: productionRun?.startTime
        ? formatLocalDateTime(new Date(productionRun.startTime))
        : formatLocalDateTime(new Date()),
      endTime: productionRun?.endTime
        ? formatLocalDateTime(new Date(productionRun.endTime))
        : formatLocalDateTime(new Date()),
      operatorId: productionRun?.operatorId ?? "",
      feedstockStorageLocationId: productionRun?.feedstockStorageLocationId ?? "",
      feedstockMassUsedKg: productionRun?.feedstockMassUsedKg ?? undefined,
      feedingRateKgHr: productionRun?.feedingRateKgHr ?? undefined,
      residenceTimeMinutes: productionRun?.residenceTimeMinutes ?? undefined,
      dieselOperationLiters: productionRun?.dieselOperationLiters ?? undefined,
      dieselGensetLiters: productionRun?.dieselGensetLiters ?? undefined,
      preprocessingFuelLiters: productionRun?.preprocessingFuelLiters ?? undefined,
      electricityKwh: productionRun?.electricityKwh ?? undefined,
      biocharOutputKg: productionRun?.biocharOutputKg ?? undefined,
      biocharStorageLocationId: productionRun?.biocharStorageLocationId ?? "",
      plcDataFileUrl: productionRun?.plcDataFileUrl ?? "",
    },
  });

  // Watch facility to filter reactors and storage locations
  const watchedFacilityId = watch("facilityId");

  // Clear dependent fields when facility changes (skip if facility matches initial value)
  const initialFacilityId = preselectedFacilityId || productionRun?.facilityId || "";
  useEffect(() => {
    if (watchedFacilityId && watchedFacilityId !== initialFacilityId) {
      setValue("reactorId", "");
      setValue("feedstockStorageLocationId", "");
      setValue("biocharStorageLocationId", "");
    }
    // Only run when facility changes, not on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedFacilityId]);

  const defaultSubmitLabel = isEditMode
    ? "Update Production Run"
    : "Create Production Run";

  const handleFormSubmit = handleSubmit((data) => {
    return onSubmit(data as ProductionRunFormData);
  });

  return (
    <form onSubmit={handleFormSubmit} className="space-y-32">
      {/* Basic Information Section */}
      <div className="space-y-20">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Basic Information
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField id="status" label="Status" error={errors.status?.message}>
            <FormSelect
              id="status"
              disabled={isSubmitting}
              error={!!errors.status}
              options={statusOptions}
              {...register("status")}
            />
          </FormField>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField id="facilityId" label="Facility" error={errors.facilityId?.message} required>
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
                />
              )}
            />
          </FormField>

          <FormField id="reactorId" label="Reactor" error={errors.reactorId?.message} required>
            <Controller
              name="reactorId"
              control={control}
              render={({ field }) => (
                <EntitySelect
                  entityType="reactor"
                  value={field.value}
                  onChange={field.onChange}
                  placeholder="Select a reactor..."
                  disabled={isSubmitting || !watchedFacilityId}
                  error={!!errors.reactorId}
                  filterBy={watchedFacilityId ? { facilityId: watchedFacilityId } : undefined}
                />
              )}
            />
          </FormField>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-16 gap-y-20">
          <FormField id="date" label="Date" error={errors.date?.message} required>
            <FormInput
              id="date"
              type="date"
              disabled={isSubmitting}
              error={!!errors.date}
              {...register("date", {
                setValueAs: (v) => (v ? new Date(v) : undefined),
              })}
            />
          </FormField>

          <FormField id="startTime" label="Start Time" error={errors.startTime?.message} required>
            <FormInput
              id="startTime"
              type="datetime-local"
              disabled={isSubmitting}
              error={!!errors.startTime}
              {...register("startTime", {
                setValueAs: (v) => (v ? new Date(v) : undefined),
              })}
            />
          </FormField>

          <FormField id="endTime" label="End Time" error={errors.endTime?.message} required>
            <FormInput
              id="endTime"
              type="datetime-local"
              disabled={isSubmitting}
              error={!!errors.endTime}
              {...register("endTime", {
                setValueAs: (v) => (v ? new Date(v) : undefined),
              })}
            />
          </FormField>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField id="operatorId" label="Operator" error={errors.operatorId?.message}>
            <Controller
              name="operatorId"
              control={control}
              render={({ field }) => (
                <EntitySelect
                  entityType="operator"
                  value={field.value || undefined}
                  onChange={field.onChange}
                  placeholder="Select an operator..."
                  disabled={isSubmitting}
                  error={!!errors.operatorId}
                />
              )}
            />
          </FormField>
        </div>
      </div>

      {/* Feedstock Input Section */}
      <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Feedstock Input
        </h3>

        {!watchedFacilityId && (
          <p className="text-[var(--color-text-tertiary)] text-[var(--text-s)]">
            Please select a facility first to choose a feedstock source bin.
          </p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="feedstockStorageLocationId"
            label="Feedstock Source Bin"
            error={errors.feedstockStorageLocationId?.message}
          >
            <Controller
              name="feedstockStorageLocationId"
              control={control}
              render={({ field }) => (
                <EntitySelect
                  entityType="storageLocation"
                  value={field.value || undefined}
                  onChange={field.onChange}
                  placeholder="Select feedstock bin..."
                  disabled={isSubmitting || !watchedFacilityId}
                  error={!!errors.feedstockStorageLocationId}
                  filterBy={
                    watchedFacilityId
                      ? { facilityId: watchedFacilityId, type: "feedstock_bin" }
                      : undefined
                  }
                />
              )}
            />
          </FormField>

          <FormField
            id="feedstockMassUsedKg"
            label="Mass Used (kg)"
            error={errors.feedstockMassUsedKg?.message}
          >
            <FormInput
              id="feedstockMassUsedKg"
              type="number"
              step="0.1"
              placeholder="e.g., 500"
              disabled={isSubmitting}
              error={!!errors.feedstockMassUsedKg}
              {...register("feedstockMassUsedKg", {
                setValueAs: nullableNumericValue,
              })}
            />
          </FormField>
        </div>
      </div>

      {/* Processing Parameters Section */}
      <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Processing Parameters
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="feedingRateKgHr"
            label="Feeding Rate (kg/hr)"
            error={errors.feedingRateKgHr?.message}
            helperText="Feedstock input rate"
          >
            <FormInput
              id="feedingRateKgHr"
              type="number"
              step="0.1"
              placeholder="e.g., 420"
              disabled={isSubmitting}
              error={!!errors.feedingRateKgHr}
              {...register("feedingRateKgHr", {
                setValueAs: numericValue,
              })}
            />
          </FormField>

          <FormField
            id="residenceTimeMinutes"
            label="Residence Time (minutes)"
            error={errors.residenceTimeMinutes?.message}
            helperText="Time in reactor"
          >
            <FormInput
              id="residenceTimeMinutes"
              type="number"
              step="1"
              placeholder="e.g., 30"
              disabled={isSubmitting}
              error={!!errors.residenceTimeMinutes}
              {...register("residenceTimeMinutes", {
                setValueAs: integerValue,
              })}
            />
          </FormField>
        </div>
      </div>

      {/* Energy Inputs Section */}
      <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Energy Inputs
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="dieselOperationLiters"
            label="Diesel - Operation (liters)"
            error={errors.dieselOperationLiters?.message}
          >
            <FormInput
              id="dieselOperationLiters"
              type="number"
              step="0.1"
              placeholder="e.g., 50"
              disabled={isSubmitting}
              error={!!errors.dieselOperationLiters}
              {...register("dieselOperationLiters", {
                setValueAs: numericValue,
              })}
            />
          </FormField>

          <FormField
            id="dieselGensetLiters"
            label="Diesel - Genset (liters)"
            error={errors.dieselGensetLiters?.message}
          >
            <FormInput
              id="dieselGensetLiters"
              type="number"
              step="0.1"
              placeholder="e.g., 25"
              disabled={isSubmitting}
              error={!!errors.dieselGensetLiters}
              {...register("dieselGensetLiters", {
                setValueAs: numericValue,
              })}
            />
          </FormField>

          <FormField
            id="preprocessingFuelLiters"
            label="Preprocessing Fuel (liters)"
            error={errors.preprocessingFuelLiters?.message}
          >
            <FormInput
              id="preprocessingFuelLiters"
              type="number"
              step="0.1"
              placeholder="e.g., 10"
              disabled={isSubmitting}
              error={!!errors.preprocessingFuelLiters}
              {...register("preprocessingFuelLiters", {
                setValueAs: numericValue,
              })}
            />
          </FormField>

          <FormField
            id="electricityKwh"
            label="Electricity (kWh)"
            error={errors.electricityKwh?.message}
          >
            <FormInput
              id="electricityKwh"
              type="number"
              step="0.1"
              placeholder="e.g., 100"
              disabled={isSubmitting}
              error={!!errors.electricityKwh}
              {...register("electricityKwh", {
                setValueAs: numericValue,
              })}
            />
          </FormField>
        </div>
      </div>

      {/* Biochar Output Section */}
      <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Biochar Output
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="biocharOutputKg"
            label="Biochar Output (kg)"
            error={errors.biocharOutputKg?.message}
          >
            <FormInput
              id="biocharOutputKg"
              type="number"
              step="0.1"
              placeholder="e.g., 150"
              disabled={isSubmitting}
              error={!!errors.biocharOutputKg}
              {...register("biocharOutputKg", {
                setValueAs: numericValue,
              })}
            />
          </FormField>

          <FormField
            id="biocharStorageLocationId"
            label="Biochar Storage Location"
            error={errors.biocharStorageLocationId?.message}
          >
            <Controller
              name="biocharStorageLocationId"
              control={control}
              render={({ field }) => (
                <EntitySelect
                  entityType="storageLocation"
                  value={field.value || undefined}
                  onChange={field.onChange}
                  placeholder="Select storage location..."
                  disabled={isSubmitting || !watchedFacilityId}
                  error={!!errors.biocharStorageLocationId}
                  filterBy={
                    watchedFacilityId
                      ? { facilityId: watchedFacilityId, type: "biochar_bin" }
                      : undefined
                  }
                />
              )}
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
