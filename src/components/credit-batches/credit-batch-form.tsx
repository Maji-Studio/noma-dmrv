/**
 * CreditBatchForm component
 * Reusable credit batch form with React Hook Form integration
 *
 * Form sections:
 * 1. Overview — startDate, endDate
 * 2. Applications — Auto-matched by date range + facility (M:M via credit_batch_applications)
 * 3. Durability — read-only; inherited from the facility's default option (PDD-level decision)
 * 4. GHG Accounting — emissions/counterfactual, buffer pool % (read-only)
 * 5. Verification — registry, weight, value, currency (read-only)
 */
"use client";

import { formatUtcDate, toDateInputValue } from "@/lib/date-utils";
import { formatSafeDate } from "@/lib/format-utils";
import { useFacilityContext } from "@/hooks/use-facility-context";

import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormField, FormInput, FormTextarea, SectionLabel } from "@/components/forms";
import { Button } from "@/components/ui";
import {
  creditBatchFormSchema,
  formatDurabilityOption,
  type CreditBatchFormData,
  type DurabilityOption,
} from "@/schemas/credit-batches";
import type { CreditBatch } from "@/db/schema/credits";

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
// Auto-matched accordion section
// ============================================

function AutoMatchedSection({
  title,
  count,
  totalCount,
  hasDates,
  emptyMessage,
  noMatchMessage,
  children,
}: {
  title: string;
  count: number;
  totalCount: number;
  hasDates: boolean;
  emptyMessage: string;
  noMatchMessage: string;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const panelId = `auto-matched-${title.toLowerCase().replace(/\s+/g, "-")}-panel`;

  if (totalCount === 0) {
    return (
      <div className="space-y-12 pt-16 border-t border-[var(--color-border-tertiary)]">
        <SectionLabel>{title}</SectionLabel>
        <div className="p-16 bg-[var(--color-background-medium)] body-small text-[var(--color-text-secondary)]">
          {emptyMessage}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-12 pt-16 border-t border-[var(--color-border-tertiary)]">
      <div className="flex items-center justify-between">
        <SectionLabel hint="Automatically matched based on the crediting period above.">
          {title}
        </SectionLabel>
        {hasDates && count > 0 && (
          <span className="inline-flex items-center px-8 py-2 body-caption font-medium bg-[var(--clr-purple-10)] text-[var(--clr-purple)]">
            {count} matched
          </span>
        )}
      </div>

      {!hasDates ? (
        <div className="flex items-start gap-10 py-12 px-16 border-l-2 border-[var(--color-border-primary)] bg-[var(--color-background-sunken)]">
          <span className="body-small text-[var(--color-text-tertiary)]">
            Set start and end dates to auto-match {title.toLowerCase()}.
          </span>
        </div>
      ) : count === 0 ? (
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
              {count} {title.toLowerCase()} in date range
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
// Rich data types for selectors
// ============================================

export interface ApplicationOption {
  id: string;
  code: string;
  applicationDate: Date | null;
  biocharAppliedDryTons: number | null;
  fieldIdentifier: string | null;
  facilityId: string;
}

export interface ExistingBatchPeriod {
  id: string;
  code: string;
  facilityId: string;
  startDate: string;
  endDate: string;
}

interface CreditBatchFormProps {
  /** Existing credit batch data for editing (undefined for create mode) */
  creditBatch?: CreditBatch & { applicationIds?: string[] };
  /** Available applications for multi-select */
  applications?: ApplicationOption[];
  /** Existing credit batch periods for overlap detection */
  existingBatches?: ExistingBatchPeriod[];
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
}

export function CreditBatchForm({
  creditBatch,
  applications = [],
  existingBatches = [],
  onSubmit,
  onClearServerError,
  onCancel,
  isSubmitting = false,
  submitLabel,
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
      applicationIds: creditBatch?.applicationIds ?? [],
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

  // Watch dates and facilityId for auto-matching
  const watchedStartDate = useWatch({ control, name: "startDate" });
  const watchedEndDate = useWatch({ control, name: "endDate" });
  const watchedFacilityId = useWatch({ control, name: "facilityId" });
  const durabilityOption = useWatch({ control, name: "durabilityOption" });
  const effectiveFacilityId = watchedFacilityId || contextFacilityId || "";

  const startDate = parseWatchedDate(watchedStartDate);
  const endDate = parseWatchedDate(watchedEndDate);
  const hasBothDates = startDate != null && endDate != null && endDate >= startDate;

  // Derive matched items from date range + facility (no manual selection)
  const startDateStr = startDate ? formatUtcDate(startDate) : "";
  const endDateStr = endDate ? formatUtcDate(endDate) : "";

  // Filter applications by effective facility before date matching
  const facilityApps = applications.filter(
    (app) => app.facilityId === effectiveFacilityId
  );

  const matchedApps = hasBothDates
    ? facilityApps.filter((app) => {
        if (!app.applicationDate) return false;
        const d = formatUtcDate(new Date(app.applicationDate));
        return d >= startDateStr && d <= endDateStr;
      })
    : [];
  const matchedAppIds = matchedApps.map((a) => a.id).join(",");

  // Sync matched IDs into form state for submission
  useEffect(() => {
    setValue("applicationIds", matchedAppIds ? matchedAppIds.split(",") : [], {
      shouldValidate: true,
    });
  }, [matchedAppIds, setValue]);

  // Overlap detection (client-side warning) — uses watched facilityId
  const overlappingBatch = hasBothDates
    ? existingBatches.find((batch) => {
        if (creditBatch && batch.id === creditBatch.id) return false;
        if (batch.facilityId !== effectiveFacilityId) return false;
        return batch.startDate <= endDateStr && batch.endDate >= startDateStr;
      })
    : null;

  const defaultSubmitLabel = isEditMode
    ? "Update Credit Batch"
    : "Create Credit Batch";

  const handleFormSubmit = handleSubmit((data) => {
    onSubmit(data as CreditBatchFormData);
  });

  return (
    <form onSubmit={handleFormSubmit} className="space-y-24">
      {/* ── Overview ── */}
      <div className="space-y-16">
        <SectionLabel>Overview</SectionLabel>

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

        {/* Overlap warning */}
        {overlappingBatch && (
          <div className="flex items-start gap-10 py-12 px-16 border-l-2 border-[var(--color-signal-orange-strong)] bg-[var(--color-signal-orange-light)]">
            <span className="body-small text-[var(--color-text-primary)]">
              Date range overlaps with <strong>{overlappingBatch.code}</strong> ({overlappingBatch.startDate} – {overlappingBatch.endDate}). Credit batch timeframes cannot overlap for the same facility.
            </span>
          </div>
        )}

      </div>

      {/* ── Matched Applications ── */}
      <AutoMatchedSection
        title="Applications"
        count={matchedApps.length}
        totalCount={facilityApps.length}
        hasDates={hasBothDates}
        emptyMessage="No applications available for this facility."
        noMatchMessage="No applications fall within this date range."
      >
        {matchedApps.map((app) => (
          <div
            key={app.id}
            className="flex items-center gap-12 px-12 py-8 bg-[var(--color-background-white)] border border-[var(--color-border-tertiary)]"
          >
            <span className="body-small font-medium shrink-0">{app.code}</span>
            <span className="text-[11px] text-[var(--color-text-tertiary)] shrink-0">{formatSafeDate(app.applicationDate)}</span>
            {app.fieldIdentifier && (
              <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-quaternary)] truncate max-w-[120px]">
                {app.fieldIdentifier}
              </span>
            )}
            <div className="flex items-center gap-12 ml-auto shrink-0">
              <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-quaternary)]">Applied {formatTons(app.biocharAppliedDryTons)}</span>
            </div>
          </div>
        ))}
      </AutoMatchedSection>

      {/* ── Durability ── */}
      <div className="space-y-16 pt-16 border-t border-[var(--color-border-tertiary)]">
        <SectionLabel
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
          Durability
        </SectionLabel>

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
      </div>

      {/* ── Site Management Notes ── */}
      <div className="space-y-16 pt-16 border-t border-[var(--color-border-tertiary)]">
        <SectionLabel>Site Management</SectionLabel>

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
      </div>

      {/* ── Registry & accounting (read-only, system-populated) ── */}
      <div className="space-y-12 pt-16 border-t border-[var(--color-border-tertiary)]">
        <div className="flex items-center justify-between">
          <SectionLabel hint="Calculated by Isometric verification and registry issuance — not editable here.">
            Registry &amp; accounting
          </SectionLabel>
          <ReadOnlyBadge />
        </div>

        <dl className="grid grid-cols-2 md:grid-cols-3 gap-x-24 gap-y-20 p-20 bg-[var(--color-background-sunken)] border border-[var(--color-border-tertiary)]">
          <ReadOnlyField
            label="CO2e emissions"
            value={formatTons(creditBatch?.totalCo2eEmissionsTons ?? null)}
            hint="Project emissions"
          />
          <ReadOnlyField
            label="CO2e counterfactual"
            value={formatTons(creditBatch?.totalCo2eCounterfactualTons ?? null)}
            hint="Baseline emissions"
          />
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
            value={formatTons(creditBatch?.weightTons ?? null)}
            hint="Total credit weight"
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
      </div>

      {/* ── Form Actions ── */}
      <div className="flex items-center justify-end gap-16 pt-16 border-t border-[var(--color-border-secondary)]">
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
        <Button
          type="submit"
          variant="primary"
          disabled={isSubmitting || !!overlappingBatch}
        >
          {isSubmitting ? "Saving..." : submitLabel ?? defaultSubmitLabel}
        </Button>
      </div>
    </form>
  );
}
