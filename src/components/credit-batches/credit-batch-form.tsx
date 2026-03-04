/**
 * CreditBatchForm component
 * Reusable credit batch form with React Hook Form integration
 *
 * Form sections:
 * 1. Overview — code, facility, startDate, endDate, certifier, status
 * 2. Applications — Multi-select (M:M via credit_batch_applications)
 * 3. Durability — Toggle 200-year vs 1000-year with conditional fields
 * 4. GHG Accounting — CO2e stored/emissions/counterfactual, buffer pool %
 * 5. Verification — registry, weight, value, currency
 */
"use client";

import { numericValue } from "@/lib/form-utils";

import { useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormField, FormInput, FormSelect } from "@/components/forms";
import { Button } from "@/components/ui";
import {
  creditBatchFormSchema,
  creditBatchStatuses,
  durabilityOptions,
  formatCreditBatchStatus,
  formatDurabilityOption,
  type CreditBatchFormData,
  type CreditBatchStatus,
  type DurabilityOption,
} from "@/schemas/credit-batches";
import type { CreditBatch } from "@/db/schema/credits";

// ============================================
// Constants for select options
// ============================================

const statusOptions: readonly { value: string; label: string }[] =
  creditBatchStatuses.map((status) => ({
    value: status,
    label: formatCreditBatchStatus(status as CreditBatchStatus),
  }));

const durabilityOptionsList: readonly { value: string; label: string }[] =
  durabilityOptions.map((option) => ({
    value: option,
    label: formatDurabilityOption(option as DurabilityOption),
  }));

// ============================================
// Component
// ============================================

interface CreditBatchFormProps {
  /** Existing credit batch data for editing (undefined for create mode) */
  creditBatch?: CreditBatch & { applicationIds?: string[] };
  /** Available facilities for selection */
  facilities?: Array<{ id: string; name: string }>;
  /** Available applications for multi-select */
  applications?: Array<{ id: string; code: string }>;
  /** Form submission handler */
  onSubmit: (data: CreditBatchFormData) => Promise<void> | void;
  /** Cancel button handler */
  onCancel?: () => void;
  /** Whether the form is currently submitting */
  isSubmitting?: boolean;
  /** Custom label for the submit button */
  submitLabel?: string;
}

export function CreditBatchForm({
  creditBatch,
  facilities = [],
  applications = [],
  onSubmit,
  onCancel,
  isSubmitting = false,
  submitLabel,
}: CreditBatchFormProps) {
  const isEditMode = !!creditBatch;

  // Helper to format date for input[type="date"]
  const formatDateForInput = (date: string | Date | undefined | null): string => {
    if (!date) {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
    if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
    const d = typeof date === "string" ? new Date(date) : date;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
    setValue,
    getValues,
  } = useForm({
    resolver: zodResolver(creditBatchFormSchema),
    defaultValues: {
      facilityId: creditBatch?.facilityId ?? "",
      startDate: formatDateForInput(creditBatch?.startDate),
      endDate: formatDateForInput(creditBatch?.endDate),
      certifier: creditBatch?.certifier ?? "",
      status: (creditBatch?.status as CreditBatchStatus) ?? "draft",
      applicationIds: creditBatch?.applicationIds ?? [],
      durabilityOption:
        (creditBatch?.durabilityOption as DurabilityOption) ?? "200_year",
      hToCorgRatio: creditBatch?.hToCorgRatio ?? undefined,
      meanRandomReflectancePercent:
        creditBatch?.meanRandomReflectancePercent ?? undefined,
      stdRandomReflectance: creditBatch?.stdRandomReflectance ?? undefined,
      meanNonReactiveCarbonPercent:
        creditBatch?.meanNonReactiveCarbonPercent ?? undefined,
      stdNonReactiveCarbonPercent:
        creditBatch?.stdNonReactiveCarbonPercent ?? undefined,
      fDurableCalculated: creditBatch?.fDurableCalculated ?? undefined,
      siteManagementNotes: creditBatch?.siteManagementNotes ?? "",
    },
  });

  // Watch durability option for conditional rendering
  const durabilityOption = useWatch({
    control,
    name: "durabilityOption",
    defaultValue: "200_year",
  });

  // Clear opposite durability fields when option changes
  useEffect(() => {
    if (durabilityOption === "200_year") {
      setValue("meanRandomReflectancePercent", undefined);
      setValue("stdRandomReflectance", undefined);
      setValue("meanNonReactiveCarbonPercent", undefined);
      setValue("stdNonReactiveCarbonPercent", undefined);
    } else if (durabilityOption === "1000_year") {
      setValue("hToCorgRatio", undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [durabilityOption]);

  // Watch selected applications
  const selectedApplicationIds = useWatch({
    control,
    name: "applicationIds",
    defaultValue: [],
  });

  const defaultSubmitLabel = isEditMode
    ? "Update Credit Batch"
    : "Create Credit Batch";

  const facilityOptions = facilities.map((f) => ({
    value: f.id,
    label: f.name,
  }));

  const handleApplicationToggle = (appId: string) => {
    const current = getValues("applicationIds") || [];
    const updated = current.includes(appId)
      ? current.filter((id) => id !== appId)
      : [...current, appId];
    setValue("applicationIds", updated, { shouldValidate: true });
  };

  const handleFormSubmit = handleSubmit((data) => {
    onSubmit(data as CreditBatchFormData);
  });

  return (
    <form onSubmit={handleFormSubmit} className="space-y-20">
      {/* === Section 1: Overview === */}
      <div className="space-y-20">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Overview
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="facilityId"
            label="Facility"
            error={errors.facilityId?.message}
          >
            <FormSelect
              id="facilityId"
              placeholder="Select facility..."
              disabled={isSubmitting}
              error={!!errors.facilityId}
              options={facilityOptions}
              {...register("facilityId")}
            />
          </FormField>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="startDate"
            label="Start Date"
            error={errors.startDate?.message}
          >
            <FormInput
              id="startDate"
              type="date"
              disabled={isSubmitting}
              error={!!errors.startDate}
              {...register("startDate")}
            />
          </FormField>

          <FormField
            id="endDate"
            label="End Date"
            error={errors.endDate?.message}
          >
            <FormInput
              id="endDate"
              type="date"
              disabled={isSubmitting}
              error={!!errors.endDate}
              {...register("endDate")}
            />
          </FormField>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="certifier"
            label="Certifier"
            error={errors.certifier?.message}
          >
            <FormInput
              id="certifier"
              type="text"
              placeholder="e.g., Isometric"
              disabled={isSubmitting}
              error={!!errors.certifier}
              {...register("certifier")}
            />
          </FormField>

          <FormField
            id="status"
            label="Status"
            error={errors.status?.message}
          >
            <FormSelect
              id="status"
              placeholder="Select status..."
              disabled={isSubmitting}
              error={!!errors.status}
              options={statusOptions}
              {...register("status")}
            />
          </FormField>
        </div>
      </div>

      {/* === Section 2: Applications === */}
      <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Applications
        </h3>
        <p className="text-[var(--text-xs)] text-[var(--color-text-tertiary)]">
          Select applications to include in this credit batch
        </p>

        {applications.length === 0 ? (
          <div className="p-24 bg-[var(--color-surface-light)] rounded-4 text-[var(--text-s)] text-[var(--color-text-secondary)]">
            No applications available. Create applications first to link them to
            credit batches.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-16 max-h-[240px] overflow-y-auto p-16 border border-[var(--color-border-primary)] rounded-4">
            {applications.map((app) => (
              <label
                key={app.id}
                className={`flex items-center gap-16 p-16 rounded-4 cursor-pointer transition-colors focus-within:ring-2 focus-within:ring-[var(--color-interaction)] ${
                  selectedApplicationIds?.includes(app.id)
                    ? "bg-[var(--clr-dark-purple)] text-white"
                    : "bg-[var(--color-surface-light)] hover:bg-[var(--color-surface-medium)]"
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedApplicationIds?.includes(app.id) ?? false}
                  onChange={() => handleApplicationToggle(app.id)}
                  disabled={isSubmitting}
                  className="sr-only"
                />
                <span className="text-[var(--text-s)]">{app.code}</span>
              </label>
            ))}
          </div>
        )}
        {errors.applicationIds && (
          <p className="text-[var(--text-xs)] text-[var(--color-error)]">
            {errors.applicationIds.message}
          </p>
        )}
      </div>

      {/* === Section 3: Durability === */}
      <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Durability
        </h3>
        <p className="text-[var(--text-xs)] text-[var(--color-text-tertiary)]">
          Isometric Protocol: Choose durability crediting option (200-year or
          1000-year)
        </p>

        <FormField
          id="durabilityOption"
          label="Durability Option"
          error={errors.durabilityOption?.message}
        >
          <FormSelect
            id="durabilityOption"
            placeholder="Select option..."
            disabled={isSubmitting}
            error={!!errors.durabilityOption}
            options={durabilityOptionsList}
            {...register("durabilityOption")}
          />
        </FormField>

        {/* Conditional fields for 200-year */}
        {durabilityOption === "200_year" && (
          <div className="p-24 bg-[var(--color-surface-light)] rounded-4 space-y-24">
            <p className="text-[var(--text-xs)] text-[var(--color-text-secondary)] font-medium">
              200-Year Durability (Woolf et al., 2021)
            </p>
            <p className="text-[var(--text-xs)] text-[var(--color-text-tertiary)]">
              Formula: F_durable,200 = min(0.95, 1 - [c + (a + b*ln(T_soil))*H/C_org])
            </p>
            <FormField
              id="hToCorgRatio"
              label="H:Corg Ratio"
              error={errors.hToCorgRatio?.message}
              helperText="Hydrogen to organic carbon ratio (0-1)"
            >
              <FormInput
                id="hToCorgRatio"
                type="number"
                step="0.001"
                placeholder="e.g., 0.4"
                disabled={isSubmitting}
                error={!!errors.hToCorgRatio}
                {...register("hToCorgRatio", {
                  setValueAs: numericValue,
                })}
              />
            </FormField>
          </div>
        )}

        {/* Conditional fields for 1000-year */}
        {durabilityOption === "1000_year" && (
          <div className="p-24 bg-[var(--color-surface-light)] rounded-4 space-y-24">
            <p className="text-[var(--text-xs)] text-[var(--color-text-secondary)] font-medium">
              1000-Year Durability (Sanei et al., 2024)
            </p>
            <p className="text-[var(--text-xs)] text-[var(--color-text-tertiary)]">
              Based on petrographic analysis (R_0) and TGA (non-reactive carbon)
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
              <FormField
                id="meanRandomReflectancePercent"
                label="Mean R_0 Reflectance (%)"
                error={errors.meanRandomReflectancePercent?.message}
                helperText="Mean random reflectance from samples"
              >
                <FormInput
                  id="meanRandomReflectancePercent"
                  type="number"
                  step="0.01"
                  placeholder="e.g., 2.5"
                  disabled={isSubmitting}
                  error={!!errors.meanRandomReflectancePercent}
                  {...register("meanRandomReflectancePercent", {
                    setValueAs: numericValue,
                  })}
                />
              </FormField>

              <FormField
                id="stdRandomReflectance"
                label="Std Dev R_0"
                error={errors.stdRandomReflectance?.message}
                helperText="Standard deviation"
              >
                <FormInput
                  id="stdRandomReflectance"
                  type="number"
                  step="0.01"
                  placeholder="e.g., 0.3"
                  disabled={isSubmitting}
                  error={!!errors.stdRandomReflectance}
                  {...register("stdRandomReflectance", {
                    setValueAs: numericValue,
                  })}
                />
              </FormField>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
              <FormField
                id="meanNonReactiveCarbonPercent"
                label="Mean Non-Reactive Carbon (%)"
                error={errors.meanNonReactiveCarbonPercent?.message}
                helperText="Mean from TGA analysis"
              >
                <FormInput
                  id="meanNonReactiveCarbonPercent"
                  type="number"
                  step="0.01"
                  placeholder="e.g., 85.0"
                  disabled={isSubmitting}
                  error={!!errors.meanNonReactiveCarbonPercent}
                  {...register("meanNonReactiveCarbonPercent", {
                    setValueAs: numericValue,
                  })}
                />
              </FormField>

              <FormField
                id="stdNonReactiveCarbonPercent"
                label="Std Dev Non-Reactive Carbon"
                error={errors.stdNonReactiveCarbonPercent?.message}
                helperText="Standard deviation"
              >
                <FormInput
                  id="stdNonReactiveCarbonPercent"
                  type="number"
                  step="0.01"
                  placeholder="e.g., 2.5"
                  disabled={isSubmitting}
                  error={!!errors.stdNonReactiveCarbonPercent}
                  {...register("stdNonReactiveCarbonPercent", {
                    setValueAs: numericValue,
                  })}
                />
              </FormField>
            </div>
          </div>
        )}

        <FormField
          id="fDurableCalculated"
          label="Calculated Durability Fraction"
          error={errors.fDurableCalculated?.message}
          helperText="F_durable (max 0.95)"
        >
          <FormInput
            id="fDurableCalculated"
            type="number"
            step="0.001"
            placeholder="e.g., 0.85"
            disabled={isSubmitting}
            error={!!errors.fDurableCalculated}
            {...register("fDurableCalculated", {
              setValueAs: numericValue,
            })}
          />
        </FormField>
      </div>

      {/* === Section 4: GHG Accounting (read-only, populated during verification) === */}
      <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)] opacity-50">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          GHG Accounting
        </h3>
        <p className="text-[var(--text-xs)] text-[var(--color-text-tertiary)]">
          Populated during Isometric verification. Net CO2e = Stored - Emissions - Counterfactual
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-16 gap-y-20">
          <FormField
            id="totalCo2eStoredTons"
            label="CO2e Stored (tons)"
            helperText="Total carbon durably stored"
          >
            <FormInput
              id="totalCo2eStoredTons"
              type="number"
              step="0.01"
              placeholder="—"
              disabled
              value={creditBatch?.totalCo2eStoredTons ?? ""}

            />
          </FormField>

          <FormField
            id="totalCo2eEmissionsTons"
            label="CO2e Emissions (tons)"
            helperText="Project emissions"
          >
            <FormInput
              id="totalCo2eEmissionsTons"
              type="number"
              step="0.01"
              placeholder="—"
              disabled
              value={creditBatch?.totalCo2eEmissionsTons ?? ""}

            />
          </FormField>

          <FormField
            id="totalCo2eCounterfactualTons"
            label="CO2e Counterfactual (tons)"
            helperText="Baseline emissions"
          >
            <FormInput
              id="totalCo2eCounterfactualTons"
              type="number"
              step="0.01"
              placeholder="—"
              disabled
              value={creditBatch?.totalCo2eCounterfactualTons ?? ""}

            />
          </FormField>
        </div>

        <FormField
          id="bufferPoolPercent"
          label="Buffer Pool (%)"
          helperText="Risk-based buffer (2-20%)"
        >
          <FormInput
            id="bufferPoolPercent"
            type="number"
            step="0.1"
            placeholder="—"
            disabled
            value={creditBatch?.bufferPoolPercent ?? ""}
            readOnly
          />
        </FormField>
      </div>

      {/* === Section 5: Verification (read-only, populated after issuance) === */}
      <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)] opacity-50">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Verification
        </h3>
        <p className="text-[var(--text-xs)] text-[var(--color-text-tertiary)]">
          Populated after registry issuance
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField id="registry" label="Registry">
            <FormInput
              id="registry"
              type="text"
              placeholder="—"
              disabled
              value={creditBatch?.registry ?? ""}

            />
          </FormField>

          <FormField
            id="weightTons"
            label="Weight (tons)"
            helperText="Total credit weight"
          >
            <FormInput
              id="weightTons"
              type="number"
              placeholder="—"
              disabled
              value={creditBatch?.weightTons ?? ""}

            />
          </FormField>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField id="value" label="Value" helperText="Credit value">
            <FormInput
              id="value"
              type="number"
              placeholder="—"
              disabled
              value={creditBatch?.value ?? ""}

            />
          </FormField>

          <FormField id="currency" label="Currency">
            <FormInput
              id="currency"
              type="text"
              placeholder="—"
              disabled
              value={creditBatch?.currency ?? ""}

            />
          </FormField>
        </div>
      </div>

      {/* === Site Management Notes (editable) === */}
      <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
        <FormField
          id="siteManagementNotes"
          label="Site Management Notes"
          error={errors.siteManagementNotes?.message}
          helperText="Irrigation, tillage, fertilizer summary"
        >
          <textarea
            id="siteManagementNotes"
            placeholder="Enter site management notes..."
            disabled={isSubmitting}
            className={`w-full h-[48px] px-16 border rounded-4 text-[var(--text-m)] min-h-[100px] resize-y ${
              errors.siteManagementNotes
                ? "border-[var(--color-error)]"
                : "border-[var(--color-border-primary)]"
            } focus:outline-none focus:ring-2 focus:ring-[var(--clr-dark-purple)] disabled:bg-[var(--color-surface-light)] disabled:cursor-not-allowed`}
            {...register("siteManagementNotes")}
          />
        </FormField>
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
