/**
 * ProductionRunForm component
 * Reusable production run form with React Hook Form integration
 * Features multi-select feedstock input with mass tracking
 */
"use client";

import { numericValue, integerValue } from "@/lib/form-utils";

import { useEffect } from "react";
import { useForm, Controller, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash } from "@phosphor-icons/react";
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
import { useNextProductionRunCode } from "@/hooks/use-production-runs";

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

  // Get next available code for new production runs
  const { data: nextCode } = useNextProductionRunCode(!isEditMode);

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
      code: productionRun?.code ?? "",
      facilityId: preselectedFacilityId || productionRun?.facilityId || "",
      date: productionRun?.date
        ? new Date(productionRun.date).toISOString().split("T")[0]
        : new Date().toISOString().split("T")[0],
      reactorId: productionRun?.reactorId ?? "",
      status: (productionRun?.status as ProductionRunStatus) ?? "draft",
      startTime: productionRun?.startTime
        ? new Date(productionRun.startTime).toISOString().slice(0, 16)
        : new Date().toISOString().slice(0, 16),
      endTime: productionRun?.endTime
        ? new Date(productionRun.endTime).toISOString().slice(0, 16)
        : new Date().toISOString().slice(0, 16),
      operatorId: productionRun?.operatorId ?? "",
      feedstocks: productionRun?.feedstocks?.map((f) => ({
        feedstockId: f.feedstockId,
        massUsedKg: f.massUsedKg,
      })) ?? [{ feedstockId: "", massUsedKg: 0 }],
      feedingRateKgHr: productionRun?.feedingRateKgHr ?? undefined,
      residenceTimeMinutes: productionRun?.residenceTimeMinutes ?? undefined,
      dieselOperationLiters: productionRun?.dieselOperationLiters ?? undefined,
      dieselGensetLiters: productionRun?.dieselGensetLiters ?? undefined,
      preprocessingFuelLiters: productionRun?.preprocessingFuelLiters ?? undefined,
      electricityKwh: productionRun?.electricityKwh ?? undefined,
      biocharOutputKg: productionRun?.biocharOutputKg ?? undefined,
      biocharStorageLocationId: productionRun?.biocharStorageLocationId ?? "",
      feedstockStorageLocationId: productionRun?.feedstockStorageLocationId ?? "",
      plcDataFileUrl: productionRun?.plcDataFileUrl ?? "",
    },
  });

  // Auto-fill code for new production runs
  useEffect(() => {
    if (!isEditMode && nextCode) {
      setValue("code", nextCode);
    }
  }, [isEditMode, nextCode, setValue]);

  const { fields, append, remove } = useFieldArray({
    control,
    name: "feedstocks",
  });

  // Watch facility to filter reactors and feedstocks
  const watchedFacilityId = watch("facilityId");

  const defaultSubmitLabel = isEditMode
    ? "Update Production Run"
    : "Create Production Run";

  const handleFormSubmit = handleSubmit((data) => {
    onSubmit(data as ProductionRunFormData);
  });

  return (
    <form onSubmit={handleFormSubmit} className="space-y-32">
      {/* Basic Information Section */}
      <div className="space-y-20">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Basic Information
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField id="code" label="Production Run Code" error={errors.code?.message}>
            <FormInput
              id="code"
              type="text"
              placeholder="Auto-generated if empty"
              disabled={isSubmitting}
              error={!!errors.code}
              {...register("code")}
            />
          </FormField>

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
          <FormField id="facilityId" label="Facility" error={errors.facilityId?.message}>
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

          <FormField id="reactorId" label="Reactor" error={errors.reactorId?.message}>
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
          <FormField id="date" label="Date" error={errors.date?.message}>
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

          <FormField id="startTime" label="Start Time" error={errors.startTime?.message}>
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

          <FormField id="endTime" label="End Time" error={errors.endTime?.message}>
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

        <FormField id="operatorId" label="Operator (Optional)" error={errors.operatorId?.message}>
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

      {/* Feedstocks Section (M:M relationship) */}
      <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
        <div className="flex items-center justify-between">
          <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
            Feedstocks
          </h3>
          <Button
            type="button"
            variant="noOutline"
            size="small"
            onClick={() => append({ feedstockId: "", massUsedKg: 0 })}
            disabled={isSubmitting || !watchedFacilityId}
          >
            <Plus size={16} weight="bold" />
            Add Feedstock
          </Button>
        </div>

        {errors.feedstocks?.message && (
          <p className="text-[var(--color-signal-red)] text-[var(--text-s)]">
            {errors.feedstocks.message}
          </p>
        )}

        {!watchedFacilityId && (
          <p className="text-[var(--color-text-tertiary)] text-[var(--text-s)]">
            Please select a facility first to choose feedstocks.
          </p>
        )}

        <div className="space-y-16">
          {fields.map((field, index) => (
            <div
              key={field.id}
              className="flex items-start gap-16 p-24 bg-[var(--color-surface-light)] rounded-[var(--radius-8)] border border-[var(--color-border-tertiary)]"
            >
              <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
                <FormField
                  id={`feedstocks.${index}.feedstockId`}
                  label="Feedstock"
                  error={errors.feedstocks?.[index]?.feedstockId?.message}
                >
                  <Controller
                    name={`feedstocks.${index}.feedstockId`}
                    control={control}
                    render={({ field: fieldProps }) => (
                      <EntitySelect
                        entityType="feedstock"
                        value={fieldProps.value}
                        onChange={fieldProps.onChange}
                        placeholder="Select feedstock..."
                        disabled={isSubmitting || !watchedFacilityId}
                        error={!!errors.feedstocks?.[index]?.feedstockId}
                        filterBy={watchedFacilityId ? { facilityId: watchedFacilityId } : undefined}
                      />
                    )}
                  />
                </FormField>

                <FormField
                  id={`feedstocks.${index}.massUsedKg`}
                  label="Mass Used (kg)"
                  error={errors.feedstocks?.[index]?.massUsedKg?.message}
                >
                  <FormInput
                    id={`feedstocks.${index}.massUsedKg`}
                    type="number"
                    step="0.01"
                    placeholder="e.g., 500"
                    disabled={isSubmitting}
                    error={!!errors.feedstocks?.[index]?.massUsedKg}
                    {...register(`feedstocks.${index}.massUsedKg`, {
                      setValueAs: (v) =>
                        v === "" || v === null || v === undefined
                          ? 0
                          : parseFloat(v),
                    })}
                  />
                </FormField>
              </div>

              {fields.length > 1 && (
                <Button
                  type="button"
                  variant="noOutline"
                  size="small"
                  onClick={() => remove(index)}
                  disabled={isSubmitting}
                  className="mt-[26px] text-[var(--color-signal-red)]"
                >
                  <Trash size={18} weight="bold" />
                </Button>
              )}
            </div>
          ))}
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
                      ? { facilityId: watchedFacilityId, type: "biochar_pile" }
                      : undefined
                  }
                />
              )}
            />
          </FormField>

          <FormField
            id="feedstockStorageLocationId"
            label="Feedstock Source Location"
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
                  placeholder="Select storage location..."
                  disabled={isSubmitting || !watchedFacilityId}
                  error={!!errors.feedstockStorageLocationId}
                  filterBy={
                    watchedFacilityId
                      ? { facilityId: watchedFacilityId }
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
