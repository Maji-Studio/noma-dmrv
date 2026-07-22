/**
 * CreditBatchForm component
 * Reusable credit batch form with React Hook Form integration
 *
 * Form sections:
 * 1. Batch definition — feedstock, startDate, endDate, notes
 * 2. Production cohort — selected production runs in the production window
 * Facility durability and registry/accounting values are intentionally absent:
 * neither is a batch input.
 */
"use client";

import { formatUtcDate, toDateInputValue } from "@/lib/date-utils";
import { formatDate } from "@/lib/format-utils";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { useFacilityCertifierSummary } from "@/hooks/use-certification";
import { useFeedstockTypeList } from "@/hooks/use-feedstock-types";
import { useMethodBEligibility } from "@/hooks/use-production-processes";
import { kgToTonnes } from "@/lib/calculations/unit-conversions";

import { useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowsClockwiseIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react/dist/ssr";
import { FormField, FormInput, FormTextarea, FormEntitySelect, FormSection, SectionLabel, FormActions } from "@/components/forms";
import { Button } from "@/components/ui";
import {
  creditBatchFormSchema,
  type CreditBatchFormData,
} from "@/schemas/credit-batches";
import type { CreditBatch } from "@/db/schema/credits";
import type { CreditBatchProductionRunOption } from "@/data-access/credit-batches";
import { useCreditBatchProductionRunOptions } from "@/hooks/use-credit-batches";
import { CohortInputLedger } from "./cohort-input-ledger";
import { CreditBatchSamplingControl } from "./credit-batch-sampling-control";
import { MethodBPrerequisitesSetup } from "./method-b-prerequisites-setup";

const COHORT_LIST_HEIGHT_CLASS = "max-h-[320px]";

// ============================================
// Format helpers
// ============================================

function formatTons(value: number | null): string {
  if (value == null) return "—";
  return `${value.toFixed(2)} t`;
}

// ============================================
// Cohort picker accordion section
// ============================================

function CohortPickerSection({
  title,
  count,
  totalCount,
  hasDates,
  isError,
  onRetry,
  isRetrying,
  notReadyMessage,
  noMatchMessage,
  noMatchWithSelectionMessage,
  children,
}: {
  title: string;
  count: number;
  totalCount: number;
  /** Whether the cohort's prerequisites (feedstock + window) are all set. */
  hasDates: boolean;
  /** True when the underlying production-run-options query has failed. */
  isError?: boolean;
  /** Refetch handler surfaced by the fetch-error retry affordance. */
  onRetry?: () => void;
  /** Disables the retry button while a refetch is already in flight. */
  isRetrying?: boolean;
  notReadyMessage: string;
  noMatchMessage: string;
  noMatchWithSelectionMessage?: string;
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

      {hasDates && isError ? (
        <div
          role="alert"
          className="flex items-start gap-10 py-12 px-16 border-l-2 border-[var(--color-signal-red)] bg-[var(--clr-red-10)]"
        >
          <WarningCircleIcon
            size={16}
            weight="fill"
            aria-hidden
            className="mt-1 shrink-0 text-[var(--color-signal-red)]"
          />
          <div className="flex flex-1 items-center justify-between gap-12">
            <span className="body-small text-[var(--color-signal-red)]">
              Couldn&apos;t load production runs for this window. Try again.
            </span>
            {onRetry && (
              <Button
                type="button"
                variant="noOutline"
                size="small"
                onClick={onRetry}
                disabled={isRetrying}
              >
                <ArrowsClockwiseIcon size={14} />
                {isRetrying ? "Retrying…" : "Retry"}
              </Button>
            )}
          </div>
        </div>
      ) : !hasDates ? (
        <div className="flex items-start gap-10 py-12 px-16 border-l-2 border-[var(--color-border-primary)] bg-[var(--color-background-sunken)]">
          <span className="body-small text-[var(--color-text-tertiary)]">
            {notReadyMessage}
          </span>
        </div>
      ) : totalCount === 0 && count === 0 ? (
        <div className="flex items-start justify-between gap-10 py-12 px-16 border-l-2 border-[var(--color-border-primary)] bg-[var(--color-background-sunken)]">
          <span className="body-small text-[var(--color-text-tertiary)]">
            {noMatchMessage}
          </span>
          {/* A successful-but-stale cached empty result would otherwise be a
              dead end (e.g. a run completed seconds ago in another tab) —
              give the operator an explicit refresh (QA 2026-07-21 F5). */}
          {onRetry && (
            <Button
              type="button"
              variant="noOutline"
              size="small"
              onClick={onRetry}
              disabled={isRetrying}
            >
              <ArrowsClockwiseIcon size={14} />
              {isRetrying ? "Refreshing…" : "Refresh"}
            </Button>
          )}
        </div>
      ) : totalCount === 0 ? (
        <div className="space-y-8">
          <div className="flex items-start gap-10 py-12 px-16 border-l-2 border-[var(--color-border-primary)] bg-[var(--color-background-sunken)]">
            <span className="body-small text-[var(--color-text-tertiary)]">
              {noMatchWithSelectionMessage ?? noMatchMessage}
            </span>
          </div>
          <div
            className={`grid grid-cols-1 gap-8 ${COHORT_LIST_HEIGHT_CLASS} overflow-y-auto`}
          >
            {children}
          </div>
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
            <div
              id={panelId}
              role="region"
              className={`grid grid-cols-1 gap-8 p-8 ${COHORT_LIST_HEIGHT_CLASS} overflow-y-auto`}
            >
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
  /** Owner/admin capability, computed on the server by the page. */
  canManage?: boolean;
}

export function CreditBatchForm({
  creditBatch,
  onSubmit,
  onClearServerError,
  onCancel,
  isSubmitting = false,
  submitLabel,
  stickyActions = true,
  canManage = false,
}: CreditBatchFormProps) {
  const isEditMode = !!creditBatch;
  const { facilityId: contextFacilityId } = useFacilityContext();

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
      feedstockTypeId: creditBatch?.feedstockTypeId ?? "",
      startDate: toDateInputValue(creditBatch?.startDate),
      endDate: toDateInputValue(creditBatch?.endDate),
      sampling: creditBatch?.sampling ?? "sampled",
      productionRunIds: creditBatch?.productionRunIds ?? [],
      siteManagementNotes: creditBatch?.siteManagementNotes ?? "",
    },
  });

  // Sync facilityId from context when it arrives after mount
  useEffect(() => {
    if (!creditBatch && contextFacilityId) {
      setValue("facilityId", contextFacilityId);
    }
  }, [creditBatch, contextFacilityId, setValue]);

  // Watch dates, facility, and declared feedstock type for cohort selection
  const watchedStartDate = useWatch({ control, name: "startDate" });
  const watchedEndDate = useWatch({ control, name: "endDate" });
  const watchedFacilityId = useWatch({ control, name: "facilityId" });
  const watchedFeedstockTypeId = useWatch({ control, name: "feedstockTypeId" });
  const watchedSampling = useWatch({ control, name: "sampling" });
  const watchedProductionRunIds = useWatch({ control, name: "productionRunIds" });
  const effectiveFacilityId = watchedFacilityId || contextFacilityId || "";
  const declaredFeedstockTypeId = watchedFeedstockTypeId || "";
  const selectedSampling = watchedSampling === "unsampled" ? "unsampled" : "sampled";
  const certifierSummary = useFacilityCertifierSummary(
    effectiveFacilityId,
    !!effectiveFacilityId,
  );
  const feedstockTypesQuery = useFeedstockTypeList();
  const selectedFeedstockType = feedstockTypesQuery.data?.find(
    (feedstockType) => feedstockType.id === declaredFeedstockTypeId,
  );
  const showSamplingControl =
    Boolean(certifierSummary.data?.mapping) &&
    selectedFeedstockType?.usage === "pyrolysis";
  const methodBEligibility = useMethodBEligibility(
    effectiveFacilityId,
    declaredFeedstockTypeId,
    showSamplingControl && !isEditMode,
  );
  const displayedSampling =
    isEditMode ||
    selectedSampling === "sampled" ||
    methodBEligibility.data?.unsampledAllowed
      ? selectedSampling
      : "sampled";

  const startDate = parseWatchedDate(watchedStartDate);
  const endDate = parseWatchedDate(watchedEndDate);
  const hasBothDates = startDate != null && endDate != null && endDate >= startDate;
  // The cohort is scoped by BOTH the window and the declared feedstock type
  // (ADR 0016 amendment): runs load only once both are set.
  const isCohortReady = hasBothDates && declaredFeedstockTypeId !== "";

  const startDateStr = startDate ? formatUtcDate(startDate) : "";
  const endDateStr = endDate ? formatUtcDate(endDate) : "";
  const selectedProductionRunIds = Array.isArray(watchedProductionRunIds)
    ? watchedProductionRunIds
    : [];
  const {
    data: productionRunOptions = [],
    isSuccess: productionRunOptionsLoaded,
    isError: productionRunOptionsErrored,
    isFetching: productionRunOptionsFetching,
    refetch: refetchProductionRunOptions,
  } = useCreditBatchProductionRunOptions({
    facilityId: effectiveFacilityId || undefined,
    startDate: hasBothDates ? startDateStr : undefined,
    endDate: hasBothDates ? endDateStr : undefined,
    includeCreditBatchId: creditBatch?.id,
  });
  // Scope options to runs of exactly the declared feedstock type. A run with an
  // empty or multi-type set can't belong to a single-feedstock batch (ADR 0016),
  // so it never appears once a type is declared.
  const typedRunOptions = declaredFeedstockTypeId
    ? productionRunOptions.filter(
        (run) =>
          run.feedstockTypeIds.length === 1 &&
          run.feedstockTypeIds[0] === declaredFeedstockTypeId,
      )
    : [];
  const typedRunOptionIds = new Set(typedRunOptions.map((run) => run.id));
  const productionRunOptionsById = new Map(
    productionRunOptions.map((run) => [run.id, run]),
  );
  const retainedProductionRunOptions = selectedProductionRunIds
    .filter((runId) => !typedRunOptionIds.has(runId))
    .map((runId) => ({
      id: runId,
      run: productionRunOptionsById.get(runId),
    }));
  const selectableProductionRunIds = typedRunOptions
    .filter(
      (run) =>
        !run.assignedCreditBatchId ||
        run.assignedCreditBatchId === creditBatch?.id,
    )
    .map((run) => run.id);
  const selectedProductionRunIdsKey = selectedProductionRunIds.join(",");
  const selectableProductionRunIdsKey = selectableProductionRunIds.join(",");
  const selectedRuns = typedRunOptions.filter((run) =>
    selectedProductionRunIds.includes(run.id),
  );

  // Edit mode: prune the batch's saved members down to the still-selectable set
  // when the window changes. Only against a successfully loaded options list —
  // on edit mount (or after a failed fetch, when options fall back to []) pruning
  // would wipe the saved cohort, forcing a full re-select. `isSuccess`, not
  // `isFetched`: the latter is also true after an errored fetch.
  useEffect(() => {
    if (!productionRunOptionsLoaded || !isEditMode) {
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
    isEditMode,
    productionRunOptionsLoaded,
    selectableProductionRunIdsKey,
    selectedProductionRunIdsKey,
    setValue,
  ]);

  // Create mode: the date window IS the batch boundary, so every eligible
  // (unassigned) run in it is a member by default — opt-out, not opt-in. Re-fill
  // only when the selectable set itself changes (new window/facility); tracking
  // the last auto-filled key preserves the user's manual deselections within a
  // window instead of clobbering them on every render.
  const autoSelectedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (isEditMode || !productionRunOptionsLoaded) {
      return;
    }
    if (autoSelectedKeyRef.current === selectableProductionRunIdsKey) {
      return;
    }
    autoSelectedKeyRef.current = selectableProductionRunIdsKey;
    const nextSelected = selectableProductionRunIdsKey
      ? selectableProductionRunIdsKey.split(",")
      : [];
    if (nextSelected.join(",") !== selectedProductionRunIdsKey) {
      setValue("productionRunIds", nextSelected, { shouldValidate: true });
    }
  }, [
    isEditMode,
    productionRunOptionsLoaded,
    selectableProductionRunIdsKey,
    selectedProductionRunIdsKey,
    setValue,
  ]);

  const defaultSubmitLabel = isEditMode
    ? "Update Credit Batch"
    : "Create Credit Batch";

  const handleFormSubmit = handleSubmit((data) => {
    const sampling =
      isEditMode ||
      (showSamplingControl && methodBEligibility.data?.unsampledAllowed)
        ? data.sampling
        : "sampled";
    onSubmit({ ...data, sampling } as CreditBatchFormData);
  });

  const renderProductionRunOption = (run: CreditBatchProductionRunOption) => {
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
          {formatDate(run.date)}
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
  };

  return (
    <form onSubmit={handleFormSubmit} className="space-y-20">
      {/* ── Batch definition ── */}
      <FormSection title="Batch definition" divider={false}>

        <div className="space-y-8">
          <FormEntitySelect
            control={control}
            name="feedstockTypeId"
            label="Feedstock Type"
            entityType="feedstockType"
            placeholder="Select feedstock type..."
            disabled={isSubmitting}
            required
            filterBy={{ usage: "pyrolysis" }}
            helperText="The batch is one feedstock and scopes which runs you can add."
          />
        </div>

        <CreditBatchSamplingControl
          visible={showSamplingControl}
          isEditMode={isEditMode}
          value={displayedSampling}
          onChange={(sampling) =>
            setValue("sampling", sampling, {
              shouldDirty: true,
              shouldTouch: true,
              shouldValidate: true,
            })
          }
          eligibility={methodBEligibility.data}
          isLoading={methodBEligibility.isLoading}
          canManage={canManage}
          disabled={isSubmitting}
          prerequisitesSetup={
            methodBEligibility.data?.productionProcessId ? (
              <MethodBPrerequisitesSetup
                processId={methodBEligibility.data.productionProcessId}
                agreedBaselineSize={methodBEligibility.data.agreedBaselineSize}
              />
            ) : undefined
          }
        />

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

        <FormField
          id="siteManagementNotes"
          label="Notes"
          error={errors.siteManagementNotes?.message}
        >
          <FormTextarea
            id="siteManagementNotes"
            placeholder="Add optional notes about this credit batch…"
            disabled={isSubmitting}
            rows={3}
            error={!!errors.siteManagementNotes}
            {...register("siteManagementNotes")}
          />
        </FormField>

      </FormSection>

      {/* ── Production cohort ── */}
      <CohortPickerSection
        title="Production runs"
        count={selectedProductionRunIds.length}
        totalCount={typedRunOptions.length}
        hasDates={isCohortReady}
        isError={productionRunOptionsErrored}
        onRetry={() => refetchProductionRunOptions()}
        isRetrying={productionRunOptionsFetching}
        notReadyMessage="Select a feedstock type and set the production window to load runs."
        noMatchMessage="No runs of this feedstock type fall within the production window."
        noMatchWithSelectionMessage="No additional runs of this feedstock type fall within the production window."
      >
        {typedRunOptions.map(renderProductionRunOption)}
        {retainedProductionRunOptions.map(({ id, run }) =>
          run ? (
            renderProductionRunOption(run)
          ) : (
            <label
              key={id}
              className="flex min-h-44 items-center gap-12 px-12 py-8 border bg-[var(--color-background-white)] border-[var(--color-border-tertiary)] text-[var(--color-text-primary)]"
            >
              <input
                type="checkbox"
                value={id}
                disabled={isSubmitting}
                className="h-16 w-16 shrink-0"
                {...register("productionRunIds")}
              />
              <span className="body-small font-mono break-all">
                {id}
              </span>
            </label>
          ),
        )}
      </CohortPickerSection>

      {errors.productionRunIds?.message && (
        <p className="body-caption text-[var(--color-signal-red)]">
          {errors.productionRunIds.message}
        </p>
      )}

      {/* ── Cohort input ledger (live front-loaded production inputs) ── */}
      <CohortInputLedger runs={selectedRuns} />

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
