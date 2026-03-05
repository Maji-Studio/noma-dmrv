/**
 * ProductionRunForm component
 * Reusable production run form with React Hook Form integration
 * Uses bin-based feedstock selection with proportional allocation
 */
"use client";

import { numericValue, nullableNumericValue, integerValue } from "@/lib/form-utils";
import { formatLocalDate, formatLocalTime, combineDateAndTime } from "@/lib/date-utils";

import { useEffect, useRef } from "react";
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

const statusOptions: readonly { value: string; label: string }[] = productionRunStatuses.map((status) => ({
  value: status,
  label: formatProductionRunStatus(status),
}));

// ============================================
// Section header
// ============================================

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
      {children}
    </h3>
  );
}

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
  /** Content rendered before the form actions (e.g. sample table) */
  children?: React.ReactNode;
}

export function ProductionRunForm({
  productionRun,
  facilityId: preselectedFacilityId,
  onSubmit,
  onCancel,
  isSubmitting = false,
  submitLabel,
  children,
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
      facilityId: productionRun?.facilityId || preselectedFacilityId || "",
      date: productionRun?.date ?? formatLocalDate(new Date()),
      reactorId: productionRun?.reactorId ?? "",
      status: (productionRun?.status as ProductionRunStatus) ?? "draft",
      startTime: productionRun?.startTime
        ? formatLocalTime(new Date(productionRun.startTime))
        : formatLocalTime(new Date()),
      endTime: productionRun?.endTime ? formatLocalTime(new Date(productionRun.endTime)) : "",
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

  // Capture initial facility ID once to avoid stale closure in effect
  const initialFacilityIdRef = useRef(preselectedFacilityId || productionRun?.facilityId || "");

  // Clear dependent fields when facility changes (skip if facility matches initial value)
  useEffect(() => {
    if (watchedFacilityId && watchedFacilityId !== initialFacilityIdRef.current) {
      setValue("reactorId", "");
      setValue("feedstockStorageLocationId", "");
      setValue("biocharStorageLocationId", "");
    }
  }, [watchedFacilityId, setValue]);

  const defaultSubmitLabel = isEditMode ? "Update Production Run" : "Create Production Run";

  const handleFormSubmit = handleSubmit((data) => {
    // date comes as "YYYY-MM-DD" string from the input
    const dateStr = typeof data.date === "string" ? data.date : formatLocalDate(data.date as Date);
    const combined = {
      ...data,
      date: new Date(dateStr + "T00:00:00"), // local midnight
      startTime: combineDateAndTime(dateStr, data.startTime as string),
      endTime: combineDateAndTime(dateStr, data.endTime as string),
    };
    return onSubmit(combined as ProductionRunFormData);
  });

  return (
    <form onSubmit={handleFormSubmit} className="space-y-24">
      {/* ── Run Setup ── */}
      <div className="space-y-16">
        <SectionLabel>Run Setup</SectionLabel>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-16 gap-y-16">
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
                  autoSelectSingle
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
                  autoSelectSingle
                />
              )}
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

        <div className="grid grid-cols-1 md:grid-cols-4 gap-x-16 gap-y-16">
          <FormField id="date" label="Date" error={errors.date?.message} required>
            <FormInput id="date" type="date" disabled={isSubmitting} error={!!errors.date} {...register("date")} />
          </FormField>

          <FormField id="startTime" label="Start Time" error={errors.startTime?.message} required>
            <FormInput
              id="startTime"
              type="time"
              disabled={isSubmitting}
              error={!!errors.startTime}
              {...register("startTime")}
            />
          </FormField>

          <FormField id="endTime" label="End Time" error={errors.endTime?.message} required>
            <FormInput
              id="endTime"
              type="time"
              disabled={isSubmitting}
              error={!!errors.endTime}
              {...register("endTime")}
            />
          </FormField>

          <FormField id="operatorId" label="Operator" error={errors.operatorId?.message}>
            <Controller
              name="operatorId"
              control={control}
              render={({ field }) => (
                <EntitySelect
                  entityType="operator"
                  value={field.value || undefined}
                  onChange={field.onChange}
                  placeholder="Select operator..."
                  disabled={isSubmitting}
                  error={!!errors.operatorId}
                />
              )}
            />
          </FormField>
        </div>
      </div>

      {/* ── Feedstock & Processing ── */}
      <div className="space-y-16 pt-16 border-t border-[var(--color-border-tertiary)]">
        <SectionLabel>Feedstock & Processing</SectionLabel>

        {!watchedFacilityId && (
          <p className="text-[var(--color-text-tertiary)] body-caption">
            Select a facility above to choose a feedstock source bin.
          </p>
        )}
        <FormField
          id="feedstockStorageLocationId"
          label="Source Bin"
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
                placeholder="Select bin..."
                disabled={isSubmitting || !watchedFacilityId}
                error={!!errors.feedstockStorageLocationId}
                filterBy={watchedFacilityId ? { facilityId: watchedFacilityId, type: "feedstock_bin" } : undefined}
              />
            )}
          />
        </FormField>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-16 gap-y-16">
          <FormField id="feedstockMassUsedKg" label="Mass Used (kg)" error={errors.feedstockMassUsedKg?.message}>
            <FormInput
              id="feedstockMassUsedKg"
              type="number"
              step="0.1"
              placeholder="e.g. 500"
              disabled={isSubmitting}
              error={!!errors.feedstockMassUsedKg}
              {...register("feedstockMassUsedKg", {
                setValueAs: nullableNumericValue,
              })}
            />
          </FormField>

          <FormField id="feedingRateKgHr" label="Feed Rate (kg/hr)" error={errors.feedingRateKgHr?.message}>
            <FormInput
              id="feedingRateKgHr"
              type="number"
              step="0.1"
              placeholder="e.g. 420"
              disabled={isSubmitting}
              error={!!errors.feedingRateKgHr}
              {...register("feedingRateKgHr", {
                setValueAs: numericValue,
              })}
            />
          </FormField>

          <FormField id="residenceTimeMinutes" label="Residence (min)" error={errors.residenceTimeMinutes?.message}>
            <FormInput
              id="residenceTimeMinutes"
              type="number"
              step="1"
              placeholder="e.g. 30"
              disabled={isSubmitting}
              error={!!errors.residenceTimeMinutes}
              {...register("residenceTimeMinutes", {
                setValueAs: integerValue,
              })}
            />
          </FormField>
        </div>
      </div>

      {/* ── Output & Energy ── */}
      <div className="space-y-16 pt-16 border-t border-[var(--color-border-tertiary)]">
        <SectionLabel>Output & Energy</SectionLabel>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-16 gap-y-16">
          <FormField
            id="biocharStorageLocationId"
            label="Biochar Storage"
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
                  placeholder="Select storage..."
                  disabled={isSubmitting || !watchedFacilityId}
                  error={!!errors.biocharStorageLocationId}
                  filterBy={watchedFacilityId ? { facilityId: watchedFacilityId, type: "biochar_bin" } : undefined}
                />
              )}
            />
          </FormField>
          <FormField id="biocharOutputKg" label="Biochar Output (kg)" error={errors.biocharOutputKg?.message}>
            <FormInput
              id="biocharOutputKg"
              type="number"
              step="0.1"
              placeholder="e.g. 150"
              disabled={isSubmitting}
              error={!!errors.biocharOutputKg}
              {...register("biocharOutputKg", {
                setValueAs: numericValue,
              })}
            />
          </FormField>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-16 gap-y-16">
          <FormField id="dieselOperationLiters" label="Diesel Ops (L)" error={errors.dieselOperationLiters?.message}>
            <FormInput
              id="dieselOperationLiters"
              type="number"
              step="0.1"
              placeholder="50"
              disabled={isSubmitting}
              error={!!errors.dieselOperationLiters}
              {...register("dieselOperationLiters", {
                setValueAs: numericValue,
              })}
            />
          </FormField>

          <FormField id="dieselGensetLiters" label="Diesel Genset (L)" error={errors.dieselGensetLiters?.message}>
            <FormInput
              id="dieselGensetLiters"
              type="number"
              step="0.1"
              placeholder="25"
              disabled={isSubmitting}
              error={!!errors.dieselGensetLiters}
              {...register("dieselGensetLiters", {
                setValueAs: numericValue,
              })}
            />
          </FormField>

          <FormField
            id="preprocessingFuelLiters"
            label="Preprocess Fuel (L)"
            error={errors.preprocessingFuelLiters?.message}
          >
            <FormInput
              id="preprocessingFuelLiters"
              type="number"
              step="0.1"
              placeholder="10"
              disabled={isSubmitting}
              error={!!errors.preprocessingFuelLiters}
              {...register("preprocessingFuelLiters", {
                setValueAs: numericValue,
              })}
            />
          </FormField>

          <FormField id="electricityKwh" label="Electricity (kWh)" error={errors.electricityKwh?.message}>
            <FormInput
              id="electricityKwh"
              type="number"
              step="0.1"
              placeholder="100"
              disabled={isSubmitting}
              error={!!errors.electricityKwh}
              {...register("electricityKwh", {
                setValueAs: numericValue,
              })}
            />
          </FormField>
        </div>
      </div>

      {/* ── Slot for extra content (e.g. production samples table) ── */}
      {children}

      {/* ── Form Actions ── */}
      <div className="flex items-center justify-end gap-16 pt-16 border-t border-[var(--color-border-secondary)]">
        {onCancel && (
          <Button type="button" variant="default" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </Button>
        )}
        <Button type="submit" variant="primary" disabled={isSubmitting}>
          {isSubmitting ? "Saving..." : (submitLabel ?? defaultSubmitLabel)}
        </Button>
      </div>
    </form>
  );
}
