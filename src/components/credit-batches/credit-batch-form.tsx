/**
 * CreditBatchForm component
 * Reusable credit batch form with React Hook Form integration
 *
 * Form sections:
 * 1. Overview — startDate, endDate
 * 2. Production cohort — selected production runs in the production window
 * 3. Durability — read-only; inherited from the facility's default option (PDD-level decision)
 * 4. Registry & accounting — buffer pool %, registry, derived applied weight,
 *    value (read-only; emissions/counterfactual are registry-owned, ADR 0018)
 */
"use client";

import { formatUtcDate, toDateInputValue } from "@/lib/date-utils";
import { formatSafeDate } from "@/lib/format-utils";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { kgToTonnes } from "@/lib/calculations/unit-conversions";

import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormField, FormInput, FormTextarea, FormSection, SectionLabel, FormActions } from "@/components/forms";
import {
  creditBatchFormSchema,
  formatDurabilityOption,
  type CreditBatchFormData,
  type DurabilityOption,
} from "@/schemas/credit-batches";
import type { CreditBatch } from "@/db/schema/credits";
import type { CreditBatchProductionRunOption } from "@/data-access/credit-batches";
import { useCreditBatchProductionRunOptions } from "@/hooks/use-credit-batches";

// ============================================
// Section helpers
// ============================================

function ReadOnlyBadge() {
  return (
    <span className="inline-flex items-center px-8 py-2 body-caption text-[var(--color-text-tertiary)] bg-[var(--color-background-medium)] border border-[var(--color-border-tertiary)]">
      Auto-populated
    </span>
  );
}

// ============================================
// Format helpers
// ============================================

function formatTons(value: number | null): string {
  if (value == null) return "—";
  return `${value.toFixed(2)} t`;
}

function formatMaybe(
  value: number | string | null | undefined,
  suffix = ""
): string {
  if (value == null || value === "") return "—";
  return `${value}${suffix}`;
}

// ============================================
// Read-only display field
// ============================================

/**
 * Renders an auto-populated value as a static label/value pair rather than a
 * disabled <input>. Disabled inputs read as "editable but locked"; a plain
 * value row makes it unambiguous that the system owns this field.
 */
function ReadOnlyField({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  const isEmpty = value === "—";
  return (
    <div className="flex flex-col gap-2">
      <dt className="body-caption text-[var(--color-text-tertiary)]">{label}</dt>
      <dd
        className={`body-medium tabular-nums ${
          isEmpty
            ? "text-[var(--color-text-quaternary)]"
            : "text-[var(--color-text-primary)]"
        }`}
      >
        {value}
      </dd>
      {hint && (
        <dd className="body-caption text-[var(--color-text-quaternary)]">
          {hint}
        </dd>
      )}
    </div>
  );
}

// ============================================
// Cohort picker accordion section
// ============================================

function CohortPickerSection({
  title,
  count,
  totalCount,
  hasDates,
  noMatchMessage,
  children,
}: {
  title: string;
  count: number;
  totalCount: number;
  hasDates: boolean;
  noMatchMessage: string;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const panelId = `cohort-picker-${title.toLowerCase().replace(/\s+/g, "-")}-panel`;

  return (
    <div className="space-y-12 pt-16 border-t border-[var(--color-border-tertiary)]">
      <div className="flex items-center justify-between">
        <SectionLabel hint="Select member production runs from the production window above.">
          {title}
        </SectionLabel>
        {hasDates && count > 0 && (
          <span className="inline-flex items-center px-8 py-2 body-caption font-medium bg-[var(--clr-purple-10)] text-[var(--clr-purple)]">
            {count} selected
          </span>
        )}
      </div>

      {!hasDates ? (
        <div className="flex items-start gap-10 py-12 px-16 border-l-2 border-[var(--color-border-primary)] bg-[var(--color-background-sunken)]">
          <span className="body-small text-[var(--color-text-tertiary)]">
            Set start and end dates to load {title.toLowerCase()}.
          </span>
        </div>
      ) : totalCount === 0 ? (
        <div className="flex items-start gap-10 py-12 px-16 border-l-2 border-[var(--color-border-primary)] bg-[var(--color-background-sunken)]">
          <span className="body-small text-[var(--color-text-tertiary)]">
            {noMatchMessage}
          </span>
        </div>
      ) : (
        <div className="border border-[var(--color-border-tertiary)]">
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            aria-expanded={isOpen}
            aria-controls={panelId}
            className="w-full flex items-center justify-between px-16 py-10 bg-[var(--color-background-medium)] hover:bg-[var(--color-surface-light)] transition-colors"
          >
            <span className="body-small font-medium text-[var(--color-text-secondary)]">
              {totalCount} {title.toLowerCase()} in production window
            </span>
            <span className="body-caption text-[var(--color-text-tertiary)]">
              {isOpen ? "Collapse" : "Expand"}
            </span>
          </button>
          {isOpen && (
            <div id={panelId} role="region" className="grid grid-cols-1 gap-8 p-8 max-h-[320px] overflow-y-auto">
              {children}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function parseWatchedDate(value: unknown): Date | null {
  if (value == null || value === "") {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "string" || typeof value === "number") {
    const parsedDate = new Date(value);
    return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
  }

  return null;
}

// ============================================
interface CreditBatchFormProps {
  /** Existing credit batch data for editing (undefined for create mode) */
  creditBatch?: CreditBatch & {
    productionRunIds?: string[];
    /** Derived Σ member applications' applied tons (issue #285). */
    appliedWeightTons?: number;
  };
  /** Form submission handler */
  onSubmit: (data: CreditBatchFormData) => Promise<void> | void;
  /** Called when the user edits the date range — used to clear a stale submit-time server error (e.g. an overlap message that no longer applies) */
  onClearServerError?: () => void;
  /** Cancel button handler */
  onCancel?: () => void;
  /** Whether the form is currently submitting */
  isSubmitting?: boolean;
  /** Custom label for the submit button */
  submitLabel?: string;
  /** Sticky CTA row (side sheet) — pass false when embedded in a page card. */
  stickyActions?: boolean;
}

export function CreditBatchForm({
  creditBatch,
  onSubmit,
  onClearServerError,
  onCancel,
  isSubmitting = false,
  submitLabel,
  stickyActions = true,
}: CreditBatchFormProps) {
  const isEditMode = !!creditBatch;
  const { facilityId: contextFacilityId, selectedFacility } = useFacilityContext();

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
    setValue,
  } = useForm({
    resolver: zodResolver(creditBatchFormSchema),
    defaultValues: {
      facilityId: creditBatch?.facilityId ?? contextFacilityId ?? "",
      startDate: toDateInputValue(creditBatch?.startDate),
      endDate: toDateInputValue(creditBatch?.endDate),
      productionRunIds: creditBatch?.productionRunIds ?? [],
      durabilityOption:
        (creditBatch?.durabilityOption as DurabilityOption) ??
        (selectedFacility?.defaultDurabilityOption as DurabilityOption) ??
        "200_year",
      siteManagementNotes: creditBatch?.siteManagementNotes ?? "",
    },
  });

  // Sync facilityId from context when it arrives after mount
  useEffect(() => {
    if (!creditBatch && contextFacilityId) {
      setValue("facilityId", contextFacilityId);
    }
  }, [creditBatch, contextFacilityId, setValue]);

  // Sync durability option from facility default when it arrives
  useEffect(() => {
    if (!creditBatch && selectedFacility?.defaultDurabilityOption) {
      setValue("durabilityOption", selectedFacility.defaultDurabilityOption as DurabilityOption);
    }
  }, [creditBatch, selectedFacility?.defaultDurabilityOption, setValue]);

  // Watch dates and facilityId for cohort selection
  const watchedStartDate = useWatch({ control, name: "startDate" });
  const watchedEndDate = useWatch({ control, name: "endDate" });
  const watchedFacilityId = useWatch({ control, name: "facilityId" });
  const watchedProductionRunIds = useWatch({ control, name: "productionRunIds" });
  const durabilityOption = useWatch({ control, name: "durabilityOption" });
  const effectiveFacilityId = watchedFacilityId || contextFacilityId || "";

  const startDate = parseWatchedDate(watchedStartDate);
  const endDate = parseWatchedDate(watchedEndDate);
  const hasBothDates = startDate != null && endDate != null && endDate >= startDate;

  const startDateStr = startDate ? formatUtcDate(startDate) : "";
  const endDateStr = endDate ? formatUtcDate(endDate) : "";
  const selectedProductionRunIds = Array.isArray(watchedProductionRunIds)
    ? watchedProductionRunIds
    : [];
  const {
    data: productionRunOptions = [],
    isSuccess: productionRunOptionsLoaded,
  } = useCreditBatchProductionRunOptions({
    facilityId: effectiveFacilityId || undefined,
    startDate: hasBothDates ? startDateStr : undefined,
    endDate: hasBothDates ? endDateStr : undefined,
    includeCreditBatchId: creditBatch?.id,
  });
  const selectableProductionRunIds = productionRunOptions
    .filter(
      (run) =>
        !run.assignedCreditBatchId ||
        run.assignedCreditBatchId === creditBatch?.id,
    )
    .map((run) => run.id);
  const selectedProductionRunIdsKey = selectedProductionRunIds.join(",");
  const selectableProductionRunIdsKey = selectableProductionRunIds.join(",");

  useEffect(() => {
    // Only prune against a successfully loaded options list — on edit mount
    // (or after a failed fetch, when options fall back to []) pruning would
    // wipe the batch's member-run defaults, forcing the user to re-select the
    // whole cohort. `isSuccess`, not `isFetched`: the latter is also true
    // after an errored fetch.
    if (!productionRunOptionsLoaded) {
      return;
    }
    const selectedIds = selectedProductionRunIdsKey
      ? selectedProductionRunIdsKey.split(",")
      : [];
    const selectableProductionRunIdSet = new Set(
      selectableProductionRunIdsKey ? selectableProductionRunIdsKey.split(",") : [],
    );
    const nextSelected = selectedIds.filter((id) =>
      selectableProductionRunIdSet.has(id),
    );
    if (nextSelected.join(",") !== selectedProductionRunIdsKey) {
      setValue("productionRunIds", nextSelected, { shouldValidate: true });
    }
  }, [
    productionRunOptionsLoaded,
    selectableProductionRunIdsKey,
    selectedProductionRunIdsKey,
    setValue,
  ]);

  const defaultSubmitLabel = isEditMode
    ? "Update Credit Batch"
    : "Create Credit Batch";

  const handleFormSubmit = handleSubmit((data) => {
    onSubmit(data as CreditBatchFormData);
  });

  return (
    <form onSubmit={handleFormSubmit} className="space-y-20">
      {/* ── Overview ── */}
      <FormSection title="Overview" divider={false}>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-16">
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
              {...register("startDate", {
                onChange: () => onClearServerError?.(),
              })}
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
              {...register("endDate", {
                onChange: () => onClearServerError?.(),
              })}
            />
          </FormField>
        </div>

      </FormSection>

      {/* ── Production cohort ── */}
      <CohortPickerSection
        title="Production runs"
        count={selectedProductionRunIds.length}
        totalCount={productionRunOptions.length}
        hasDates={hasBothDates}
        noMatchMessage="No production runs fall within this production window."
      >
        {productionRunOptions.map((run: CreditBatchProductionRunOption) => {
          const assignedElsewhere =
            !!run.assignedCreditBatchId &&
            run.assignedCreditBatchId !== creditBatch?.id;
          return (
            <label
              key={run.id}
              className={`flex min-h-44 items-center gap-12 px-12 py-8 border ${
                assignedElsewhere
                  ? "bg-[var(--color-background-sunken)] border-[var(--color-border-tertiary)] text-[var(--color-text-quaternary)]"
                  : "bg-[var(--color-background-white)] border-[var(--color-border-tertiary)] text-[var(--color-text-primary)]"
              }`}
            >
              <input
                type="checkbox"
                value={run.id}
                disabled={isSubmitting || assignedElsewhere}
                className="h-16 w-16 shrink-0"
                {...register("productionRunIds")}
              />
              <span className="body-small font-medium shrink-0">{run.code}</span>
              <span className="text-[11px] text-[var(--color-text-tertiary)] shrink-0">
                {formatSafeDate(run.date)}
              </span>
              {assignedElsewhere && run.assignedCreditBatchCode && (
                <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-quaternary)] truncate">
                  Assigned to {run.assignedCreditBatchCode}
                </span>
              )}
              <span className="ml-auto text-[10px] uppercase tracking-wider text-[var(--color-text-quaternary)] shrink-0">
                Dry output{" "}
                {formatTons(
                  run.biocharDryMassKg == null
                    ? null
                    : kgToTonnes(run.biocharDryMassKg),
                )}
              </span>
            </label>
          );
        })}
      </CohortPickerSection>

      {errors.productionRunIds?.message && (
        <p className="body-caption text-[var(--color-signal-red)]">
          {errors.productionRunIds.message}
        </p>
      )}

      {/* ── Durability ── */}
      <FormSection
        title="Durability"
        hint={
          <>
            The durability crediting tier is a project-level (PDD) decision,
            set per facility and snapshotted onto the batch when it&apos;s
            created — not a per-batch claim. The <code>1000_year</code> tier
            additionally requires reflectance lab data and is not yet
            supported by the CO₂e preview.
          </>
        }
      >

        {/* Snapshotted from the facility's default at create; kept in form state
            so it round-trips on update, but not editable here. */}
        <input type="hidden" {...register("durabilityOption")} />

        <dl>
          <ReadOnlyField
            label="Durability Option"
            value={
              durabilityOption
                ? formatDurabilityOption(durabilityOption as DurabilityOption)
                : "—"
            }
            hint="Change it for future batches in the facility's settings."
          />
        </dl>
      </FormSection>

      {/* ── Site Management Notes ── */}
      <FormSection title="Site Management">

        <FormField
          id="siteManagementNotes"
          label="Notes"
          error={errors.siteManagementNotes?.message}
          helperText="Irrigation, tillage, fertilizer summary"
        >
          <FormTextarea
            id="siteManagementNotes"
            placeholder="Enter site management notes..."
            disabled={isSubmitting}
            rows={4}
            error={!!errors.siteManagementNotes}
            {...register("siteManagementNotes")}
          />
        </FormField>
      </FormSection>

      {/* ── Registry & accounting (read-only, system-populated) ── */}
      <FormSection
        title={<>Registry &amp; accounting</>}
        hint="Calculated by Isometric verification and registry issuance — not editable here."
        actions={<ReadOnlyBadge />}
        className="space-y-12"
      >
        <dl className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-24 gap-y-20 p-20 bg-[var(--color-background-sunken)] border border-[var(--color-border-tertiary)]">
          <ReadOnlyField
            label="Buffer pool"
            value={formatMaybe(creditBatch?.bufferPoolPercent ?? null, "%")}
            hint="Risk-based (2–20%)"
          />
          <ReadOnlyField
            label="Registry"
            value={formatMaybe(creditBatch?.registry)}
          />
          <ReadOnlyField
            label="Weight"
            value={formatTons(creditBatch?.appliedWeightTons ?? null)}
            hint="Applied to soil (derived)"
          />
          <ReadOnlyField
            label="Value"
            value={
              creditBatch?.value != null
                ? `${creditBatch.value}${
                    creditBatch.currency ? ` ${creditBatch.currency}` : ""
                  }`
                : "—"
            }
            hint="Credit value"
          />
        </dl>
      </FormSection>

      <FormActions
        sticky={stickyActions}
        onCancel={onCancel}
        isSubmitting={isSubmitting}
        submitLabel={submitLabel}
        defaultSubmitLabel={defaultSubmitLabel}
      />
    </form>
  );
}
