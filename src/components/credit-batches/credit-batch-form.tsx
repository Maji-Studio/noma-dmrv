/**
 * CreditBatchForm component
 * Reusable credit batch form with React Hook Form integration
 *
 * Form sections:
 * 1. Batch definition — feedstock, startDate, endDate
 * 2. Production cohort — automatic production runs in the production window
 * 3. Additional information — notes always trail the operational fields
 * Facility durability and registry/accounting values are intentionally absent:
 * neither is a batch input.
 */
"use client";

import { formatUtcDate, toDateInputValue } from "@/lib/date-utils";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { useFacilityCertifierSummary } from "@/hooks/use-certification";
import { useFeedstockTypeList } from "@/hooks/use-feedstock-types";
import { useMethodBEligibility } from "@/hooks/use-production-processes";

import { useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  FormActions,
  FormEntitySelect,
  FormField,
  FormInput,
  FormSection,
  FormTextarea,
} from "@/components/forms";
import {
  creditBatchFormSchema,
  type CreditBatchFormData,
} from "@/schemas/credit-batches";
import type { CreditBatch } from "@/db/schema/credits";
import { useCreditBatchProductionRunOptions } from "@/hooks/use-credit-batches";
import { CohortInputLedger } from "./cohort-input-ledger";
import { CreditBatchSamplingControl } from "./credit-batch-sampling-control";
import { MethodBPrerequisitesSetup } from "./method-b-prerequisites-setup";
import { COMPLETED_PRODUCTION_RUN_STATUS } from "@/lib/production-runs/lifecycle";
import { CreditBatchProductionRunsPreview } from "./credit-batch-production-runs-preview";

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
  /** Submission-level error shown with the action footer */
  errorMessage?: string;
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
  errorMessage,
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
    isLoading: productionRunOptionsLoading,
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
        run.status === COMPLETED_PRODUCTION_RUN_STATUS &&
        (!run.assignedCreditBatchId ||
          run.assignedCreditBatchId === creditBatch?.id),
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

  // Create mode: the declared boundary derives membership, so every eligible
  // unassigned run in it is included and cannot be manually excluded.
  useEffect(() => {
    if (isEditMode || !productionRunOptionsLoaded) {
      return;
    }
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

  return (
    <form onSubmit={handleFormSubmit} className="space-y-20">
      {/* ── Batch definition ── */}
      <FormSection title="Batch definition" divider={false}>

        <div className="space-y-8">
          <FormEntitySelect
            control={control}
            name="feedstockTypeId"
            label="Feedstock type"
            entityType="feedstockType"
            placeholder="Select feedstock type..."
            disabled={isSubmitting}
            required
            filterBy={{ usage: "pyrolysis" }}
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
            label="Start date"
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
            label="End date"
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
      <CreditBatchProductionRunsPreview
        matchingRuns={typedRunOptions}
        retainedRuns={retainedProductionRunOptions}
        currentCreditBatchId={creditBatch?.id}
        isReady={isCohortReady}
        isLoading={productionRunOptionsLoading}
        isError={productionRunOptionsErrored}
        onRetry={() => refetchProductionRunOptions()}
        isRetrying={productionRunOptionsFetching}
      />

      {errors.productionRunIds?.message && (
        <p className="body-caption text-[var(--color-signal-red)]">
          {errors.productionRunIds.message}
        </p>
      )}

      {/* ── Cohort input ledger (live front-loaded production inputs) ── */}
      <CohortInputLedger runs={selectedRuns} />

      {/* Free-form notes trail the operational inputs and their live preview. */}
      <FormSection title="Additional information">
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

      <FormActions
        sticky={stickyActions}
        onCancel={onCancel}
        isSubmitting={isSubmitting}
        errorMessage={errorMessage}
        submitLabel={submitLabel}
        defaultSubmitLabel={defaultSubmitLabel}
      />
    </form>
  );
}
