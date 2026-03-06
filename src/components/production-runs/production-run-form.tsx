/**
 * ProductionRunForm component
 * Reusable production run form with React Hook Form integration
 * Uses bin-based feedstock selection with proportional allocation
 */
"use client";

import { nullableNumericValue, integerValue } from "@/lib/form-utils";
import { formatLocalDate, formatLocalTime, combineDateAndTime } from "@/lib/date-utils";
import { deriveMassDryKg } from "@/lib/calculations/mass-dry";
import { useFacilityContext } from "@/hooks/use-facility-context";

import { useEffect, useRef } from "react";
import { useForm, useWatch, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormField, FormInput, FormFileUpload, SectionLabel } from "@/components/forms";
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
// Component
// ============================================

interface ProductionRunFormProps {
  /** Existing production run data for editing (undefined for create mode) */
  productionRun?: ProductionRunWithRelations;
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
  onSubmit,
  onCancel,
  isSubmitting = false,
  submitLabel,
  children,
}: ProductionRunFormProps) {
  const isEditMode = !!productionRun;
  const { facilityId: contextFacilityId } = useFacilityContext();

  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(productionRunFormSchema),
    defaultValues: {
      facilityId: productionRun?.facilityId || contextFacilityId || "",
      date: productionRun?.date ?? formatLocalDate(new Date()),
      reactorId: productionRun?.reactorId ?? "",
      status: (productionRun?.status as ProductionRunStatus) ?? "draft",
      startTime: productionRun?.startTime
        ? formatLocalTime(new Date(productionRun.startTime))
        : formatLocalTime(new Date()),
      endTime: productionRun?.endTime ? formatLocalTime(new Date(productionRun.endTime)) : "",
      operatorId: productionRun?.operatorId ?? "",
      feedstockStorageLocationId: productionRun?.feedstockStorageLocationId ?? "",
      feedstockWetMassKg: productionRun?.feedstockWetMassKg ?? undefined,
      feedstockMoisturePercent: productionRun?.feedstockMoisturePercent ?? undefined,
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
  const watchedFacilityId = useWatch({ control, name: "facilityId" });

  // Watch wet mass + moisture for dry mass preview
  const watchWetMass = useWatch({ control, name: "feedstockWetMassKg" });
  const watchMoisture = useWatch({ control, name: "feedstockMoisturePercent" });

  const previewDryMass =
    typeof watchWetMass === "number" &&
    typeof watchMoisture === "number" &&
    watchWetMass >= 0 &&
    watchMoisture >= 0 &&
    watchMoisture <= 100
      ? deriveMassDryKg(watchWetMass, watchMoisture)
      : null;

  // Track previous facility to detect real changes
  const prevFacilityRef = useRef(watchedFacilityId);

  // Sync facilityId from context when creating (context may load after mount)
  useEffect(() => {
    if (!productionRun && contextFacilityId && contextFacilityId !== watchedFacilityId) {
      setValue("facilityId", contextFacilityId);
    }
  }, [productionRun, contextFacilityId, watchedFacilityId, setValue]);

  // Clear dependent fields when facility actually changes
  useEffect(() => {
    if (prevFacilityRef.current && watchedFacilityId !== prevFacilityRef.current && !productionRun) {
      setValue("reactorId", "");
      setValue("feedstockStorageLocationId", "");
      setValue("biocharStorageLocationId", "");
    }
    prevFacilityRef.current = watchedFacilityId;
  }, [watchedFacilityId, setValue, productionRun]);

  const defaultSubmitLabel = isEditMode ? "Update Production Run" : "Create Production Run";

  const handleFormSubmit = handleSubmit((data) => {
    // date comes as "YYYY-MM-DD" string from the input
    const dateStr = typeof data.date === "string" ? data.date : formatLocalDate(data.date as Date);
    const combined = {
      ...data,
      date: new Date(dateStr + "T00:00:00"), // local midnight
      startTime: combineDateAndTime(dateStr, data.startTime as string),
      endTime: data.endTime ? combineDateAndTime(dateStr, data.endTime as string) : undefined,
    };
    return onSubmit(combined as ProductionRunFormData);
  });

  return (
    <form onSubmit={handleFormSubmit} className="space-y-24">
      {/* ── Run Setup ── */}
      <div className="space-y-16">
        <SectionLabel>Run Setup</SectionLabel>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-16">
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

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-16">
          <FormField id="date" label="Date" error={errors.date?.message} required>
            <FormInput id="date" type="date" disabled={isSubmitting} error={!!errors.date} {...register("date")} />
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

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-16">
          <FormField id="startTime" label="Start Time" error={errors.startTime?.message} required>
            <FormInput
              id="startTime"
              type="time"
              disabled={isSubmitting}
              error={!!errors.startTime}
              {...register("startTime")}
            />
          </FormField>

          <FormField id="endTime" label="End Time" error={errors.endTime?.message}>
            <FormInput
              id="endTime"
              type="time"
              disabled={isSubmitting}
              error={!!errors.endTime}
              {...register("endTime")}
            />
          </FormField>
        </div>
      </div>

      {/* ── Feedstock & Processing ── */}
      <div className="space-y-16 pt-16 border-t border-[var(--color-border-tertiary)]">
        <SectionLabel>Feedstock & Processing</SectionLabel>

        {!watchedFacilityId && (
          <p className="text-[var(--color-text-tertiary)] body-caption">
            Select a facility in the sidebar to choose a feedstock source bin.
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

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-16">
          <FormField id="feedstockWetMassKg" label="Wet Mass (kg)" error={errors.feedstockWetMassKg?.message}>
            <FormInput
              id="feedstockWetMassKg"
              type="number"
              step="0.1"
              placeholder="e.g. 500"
              disabled={isSubmitting}
              error={!!errors.feedstockWetMassKg}
              {...register("feedstockWetMassKg", {
                setValueAs: nullableNumericValue,
              })}
            />
          </FormField>

          <FormField id="feedstockMoisturePercent" label="Moisture Content (%)" error={errors.feedstockMoisturePercent?.message}>
            <FormInput
              id="feedstockMoisturePercent"
              type="number"
              step="0.1"
              placeholder="e.g. 15"
              disabled={isSubmitting}
              error={!!errors.feedstockMoisturePercent}
              {...register("feedstockMoisturePercent", {
                setValueAs: nullableNumericValue,
              })}
            />
          </FormField>
        </div>

        {/* Dry mass preview (display only — computed server-side) */}
        <div className="flex items-center gap-12 rounded-sm border border-[var(--color-border-tertiary)] bg-[var(--color-bg-tertiary)] px-16 py-12">
          <span className="body-small text-[var(--color-text-tertiary)]">Est. Dry Mass (kg)</span>
          <span className="body-medium font-medium text-[var(--color-text-primary)]">
            {previewDryMass !== null
              ? `${previewDryMass.toFixed(2)} kg`
              : "—"}
          </span>
          {previewDryMass !== null && (
            <span className="body-small text-[var(--color-text-quaternary)]">
              = {Number(watchWetMass ?? 0).toFixed(2)} × (1 − {Number(watchMoisture ?? 0).toFixed(2)}%)
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-16">
          <FormField id="feedingRateKgHr" label="Feed Rate (kg/hr)" error={errors.feedingRateKgHr?.message}>
            <FormInput
              id="feedingRateKgHr"
              type="number"
              step="0.1"
              placeholder="e.g. 420"
              disabled={isSubmitting}
              error={!!errors.feedingRateKgHr}
              {...register("feedingRateKgHr", {
                setValueAs: nullableNumericValue,
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

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-16">
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
                setValueAs: nullableNumericValue,
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
                setValueAs: nullableNumericValue,
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
                setValueAs: nullableNumericValue,
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
                setValueAs: nullableNumericValue,
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
                setValueAs: nullableNumericValue,
              })}
            />
          </FormField>
        </div>

      </div>

      {/* ── Production Readings ── */}
      <div className="space-y-16 pt-16 border-t border-[var(--color-border-tertiary)]">
        <SectionLabel>Production Readings</SectionLabel>

        <FormField
          id="plcDataFile"
          label="Readings CSV"
          helperText="UI mock only for now: selected CSV files are not uploaded or saved yet."
        >
          <FormFileUpload
            id="plcDataFile"
            accept=".csv"
            multiple={false}
            disabled={isSubmitting}
          />
        </FormField>
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
