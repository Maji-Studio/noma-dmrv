/**
 * ProductionRunForm component
 * Reusable production run form with React Hook Form integration
 * Uses bin-based feedstock selection with proportional allocation
 */
"use client";

import { nullableNumericValue, integerValue } from "@/lib/form-utils";
import { formatLocalDate, resolveFacilityTimezone } from "@/lib/date-utils";
import {
  buildProductionRunResolver,
  buildProductionRunWindow,
  productionRunTimezoneHelperText,
  productionRunTimingDefaults,
} from "./production-run-timing";
import { useProductionRunTimingZoneSync } from "./use-production-run-timing-zone-sync";
import { deriveMassDryKg } from "@/lib/calculations/mass-dry";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useFieldArray, useForm, useWatch, Controller, type Resolver } from "react-hook-form";
import { getRunConflict, type RunConflict } from "@/lib/production-runs/overlap-conflict";
import { FactoryIcon, PlantIcon, LightningIcon, PackageIcon, FlowArrowIcon, PlusIcon } from "@phosphor-icons/react/dist/ssr";
import { FormField, FormInput, FormTextarea, MassMoistureFields, MoistureField, FormActions, FormError, FormSection, FormSpine, SectionLabel, ResolvedErrorRevalidator, makeCertFieldStatus, type CertFieldStatus } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { CertificationFieldTag } from "@/components/ui/certification-field-tag";
import { ProductionReadingsField } from "./production-readings-field";
import { FormSelect } from "@/components/forms/form-select";
import {
  EntitySelect,
  StorageLocationQuickAddDialog,
  useQuickAddDialog,
} from "@/components/forms/entity-select";
import { useEntityById } from "@/hooks/use-entities";
import { isCertifyFormField } from "@/lib/certification/certify-field-registry";
import {
  formatProductionRunStatus,
  type ProductionRunFormData,
  type ProductionRunStatus,
} from "@/schemas/production-runs";
import { ProcessFlowPreview } from "./production-run-process-flow-preview";
import {
  productionRunMassBalanceFeedback,
} from "./production-run-mass-balance";
import {
  allowedProductionRunStatusesFrom,
  shouldClearProductionRunEndTime,
  shouldIncludeProductionRunEndTime,
} from "@/lib/production-runs/lifecycle";
import type { ProductionRunWithRelations } from "@/data-access/production-runs";
import type { UseDeferredAttachmentsResult } from "@/hooks/use-deferred-attachments";
import type { StorageLocationType } from "@/schemas/storage-locations";
import { ProductionRunFeedstockDrawRow } from "./production-run-feedstock-draw-row";

// ============================================
// Constants for select options
// ============================================

const isProductionRunCertifyField = (field: string) =>
  isCertifyFormField("productionRun", field);

// Quick-add on the Biochar Storage select only mints biochar bins (the run's
// output lands here), mirroring how the biochar-product form scopes its bin.
const BIOCHAR_BIN_QUICK_ADD_TYPES = ["biochar_bin"] as const satisfies readonly StorageLocationType[];
const SET_VALUE_OPTS = { shouldDirty: true, shouldTouch: true, shouldValidate: true } as const;
const EMPTY_FEEDSTOCK_DRAW = { storageLocationId: "", wetMassKg: undefined };
const FEEDSTOCK_MASS_MAX_FRACTION_DIGITS = 3;

// ============================================
// Component
// ============================================

export type ProductionRunSubmitData = Omit<ProductionRunFormData, "endTime"> & {
  endTime?: ProductionRunFormData["endTime"] | null;
  expectedUpdatedAt?: Date;
};

interface ProductionRunFormProps {
  /** Existing production run data for editing (undefined for create mode) */
  productionRun?: ProductionRunWithRelations;
  /** Form submission handler */
  onSubmit: (data: ProductionRunSubmitData) => Promise<void> | void;
  /** Cancel button handler */
  onCancel?: () => void;
  /** Whether the form is currently submitting */
  isSubmitting?: boolean;
  /** Submission-level error shown with the action footer */
  errorMessage?: string;
  /** Custom label for the submit button */
  submitLabel?: string;
  /**
   * Extension content (e.g. readings/samples/incidents tables) rendered
   * between the form fields and the CTA row — outside the `<form>` element,
   * so it may contain its own forms. Nothing ever renders after the CTA.
   */
  children?: React.ReactNode;
  deferredAttachments?: UseDeferredAttachmentsResult;
}
export function ProductionRunForm({
  productionRun,
  onSubmit,
  onCancel,
  isSubmitting = false,
  errorMessage,
  submitLabel,
  children,
  deferredAttachments,
}: ProductionRunFormProps) {
  const formId = useId();
  const isEditMode = !!productionRun;
  const transitionFrom = (productionRun?.status as ProductionRunStatus) ?? "draft";
  const statusOptions = allowedProductionRunStatusesFrom(transitionFrom).map(
    (status) => ({ value: status, label: formatProductionRunStatus(status) }),
  );
  const { facilityId: contextFacilityId, facilities } = useFacilityContext();

  // Start/end are read back in the FACILITY's zone, never the browser's — see
  // ./production-run-timing.ts for the QA F-2 data loss this prevents.
  const defaultValues = {
    facilityId: productionRun?.facilityId || contextFacilityId || "",
    reactorId: productionRun?.reactorId ?? "",
    status: (productionRun?.status as ProductionRunStatus) ?? "draft",
    cancellationReason: productionRun?.cancellationReason ?? "",
    ...productionRunTimingDefaults(
      productionRun,
      resolveFacilityTimezone(facilities, productionRun?.facilityId ?? contextFacilityId),
    ),
    operatorId: productionRun?.operatorId ?? "",
    feedstockDraws:
      productionRun?.feedstockDraws.length
        ? productionRun.feedstockDraws.map((draw) => ({
            storageLocationId: draw.storageLocationId,
            wetMassKg: draw.wetMassKg,
          }))
        : productionRun?.feedstockStorageLocationId &&
            productionRun.feedstockWetMassKg
          ? [
              {
                storageLocationId: productionRun.feedstockStorageLocationId,
                wetMassKg: productionRun.feedstockWetMassKg,
              },
            ]
          : [{ ...EMPTY_FEEDSTOCK_DRAW }],
    feedstockMoisturePercent: productionRun?.feedstockMoisturePercent ?? undefined,
    feedingRateKgHr: productionRun?.feedingRateKgHr ?? undefined,
    residenceTimeMinutes: productionRun?.residenceTimeMinutes ?? undefined,
    dieselOperationLiters: productionRun?.dieselOperationLiters ?? undefined,
    dieselGensetLiters: productionRun?.dieselGensetLiters ?? undefined,
    preprocessingFuelLiters: productionRun?.preprocessingFuelLiters ?? undefined,
    electricityKwh: productionRun?.electricityKwh ?? undefined,
    biocharOutputKg: productionRun?.biocharOutputKg ?? undefined,
    biocharMoisturePercent: productionRun?.biocharMoisturePercent ?? undefined,
    biocharStorageLocationId: productionRun?.biocharStorageLocationId ?? "",
  };
  type ProductionRunFormValues = typeof defaultValues;
  const resolver: Resolver<
    ProductionRunFormValues,
    unknown,
    ProductionRunFormData
  > = (values, context, options) =>
    (
      buildProductionRunResolver(
        resolveFacilityTimezone(facilities, values.facilityId),
      ) as unknown as Resolver<
        ProductionRunFormValues,
        unknown,
        ProductionRunFormData
      >
    )(values, context, options);
  const {
    register,
    handleSubmit,
    control,
    trigger,
    setValue,
    resetField,
    setError,
    clearErrors,
    formState: { errors, dirtyFields },
  } = useForm<ProductionRunFormValues, unknown, ProductionRunFormData>({
    // The timing cross-field checks must resolve start/end in the same zone the
    // submit path writes them in, so the schema is rebuilt per validation from
    // the facility currently chosen in the form (the facility select can differ
    // from the context facility). RHF refreshes `resolver` on every render.
    resolver,
    // onTouched so the spine markers can turn red on blur, not just on submit.
    mode: "onTouched",
    defaultValues,
  });
  const {
    fields: feedstockDrawFields,
    append: appendFeedstockDraw,
    remove: removeFeedstockDraw,
  } = useFieldArray({ control, name: "feedstockDraws" });

  // The run this run's window overlaps, if the server rejected the save (#259).
  const [overlapConflict, setOverlapConflict] = useState<RunConflict | null>(null);

  // CERT chips reflect the saved record (frozen), neutral while creating.
  const certStatus = makeCertFieldStatus(isEditMode ? defaultValues : undefined);
  // The run-status chip is satisfied only once the saved run is marked Complete
  // (a run must be Complete before it's certification-ready), not merely set.
  const runStatusCertStatus: CertFieldStatus = !isEditMode
    ? "neutral"
    : productionRun?.status === "complete"
      ? "satisfied"
      : "missing";
  // Watch facility to filter reactors and storage locations
  const watchedFacilityId = useWatch({ control, name: "facilityId" });
  const watchedStatus = useWatch({ control, name: "status" });

  // The zone the entered start/end are interpreted in — the facility picked in
  // the form, which can differ from the context facility.
  const formTimezone = resolveFacilityTimezone(facilities, watchedFacilityId);
  const timezoneHelperText = productionRunTimezoneHelperText(facilities, watchedFacilityId);

  // Watch fields for flow preview
  const watchedReactorId = useWatch({ control, name: "reactorId" });
  const watchedFeedstockDraws = useWatch({ control, name: "feedstockDraws" }) ?? [];
  const watchedSourceBinId = watchedFeedstockDraws.find(
    (draw) => !!draw?.storageLocationId,
  )?.storageLocationId;
  const selectedFeedstockDrawCount = watchedFeedstockDraws.filter(
    (draw) => !!draw?.storageLocationId,
  ).length;
  const watchedDestBinId = useWatch({ control, name: "biocharStorageLocationId" });
  const watchedBiocharKg = useWatch({ control, name: "biocharOutputKg" });
  const watchedBiocharMoisture = useWatch({ control, name: "biocharMoisturePercent" });

  // Entity lookups for flow preview labels
  const { data: selectedReactor } = useEntityById("reactor", watchedReactorId || undefined);
  const { data: selectedSourceBin } = useEntityById("storageLocation", watchedSourceBinId || undefined);
  const { data: selectedDestBin } = useEntityById("storageLocation", watchedDestBinId || undefined);
  const sourceBinPreviewName = selectedSourceBin?.name
    ? selectedFeedstockDrawCount > 1
      ? `${selectedSourceBin.name} + ${selectedFeedstockDrawCount - 1} more`
      : selectedSourceBin.name
    : null;

  // Inline quick-add for the Biochar Storage select.
  const biocharBinDialog = useQuickAddDialog();

  // Every row is wet/as-received mass. The run-level moisture reading applies
  // once to their summed input.
  const watchWetMass = watchedFeedstockDraws.reduce(
    (total, draw) =>
      total + (typeof draw?.wetMassKg === "number" ? draw.wetMassKg : 0),
    0,
  );
  const watchMoisture = useWatch({ control, name: "feedstockMoisturePercent" });

  const previewDryMass =
    typeof watchWetMass === "number" &&
    typeof watchMoisture === "number" &&
    watchWetMass >= 0 &&
    watchMoisture >= 0 &&
    watchMoisture <= 100
      ? deriveMassDryKg(watchWetMass, watchMoisture)
      : null;

  const previewBiocharDryMass =
    typeof watchedBiocharKg === "number" &&
    typeof watchedBiocharMoisture === "number" &&
    watchedBiocharKg >= 0 &&
    watchedBiocharMoisture >= 0 &&
    watchedBiocharMoisture <= 100
      ? deriveMassDryKg(watchedBiocharKg, watchedBiocharMoisture)
      : null;
  const massBalanceFeedback = productionRunMassBalanceFeedback({
    feedstockWetMassKg: watchWetMass,
    feedstockMoisturePercent: watchMoisture,
    biocharOutputKg: watchedBiocharKg,
    biocharMoisturePercent: watchedBiocharMoisture,
  });
  const biocharOutputError =
    errors.biocharOutputKg?.message ?? massBalanceFeedback.dryError;

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
      setValue("feedstockDraws", [{ ...EMPTY_FEEDSTOCK_DRAW }]);
      setValue("biocharStorageLocationId", "");
    }
    prevFacilityRef.current = watchedFacilityId;
  }, [watchedFacilityId, setValue, productionRun]);
  useProductionRunTimingZoneSync({
    timeZone: formTimezone,
    productionRun,
    dirtyFields,
    resetField,
  });

  const defaultSubmitLabel = isEditMode ? "Update Production Run" : "Create Production Run";

  const handleFormSubmit = handleSubmit(async (data) => {
    // Dates arrive as "YYYY-MM-DD" strings from the inputs. The end date
    // defaults to the start date when only an end time was entered.
    const startDateStr =
      typeof data.startDate === "string" ? data.startDate : formatLocalDate(data.startDate as Date);
    const endDateStr = data.endDate
      ? typeof data.endDate === "string"
        ? data.endDate
        : formatLocalDate(data.endDate as Date)
      : startDateStr;
    // A touched value or newly entered physical outcome submits that Date;
    // otherwise undefined means "unchanged", so a no-op edit of an already
    // terminal run never rewrites the stored end.
    const endTouched = !!dirtyFields.endDate || !!dirtyFields.endTime;
    const includeEndTime = shouldIncludeProductionRunEndTime({
      endFieldsTouched: endTouched,
      from: transitionFrom,
      to: data.status,
    });
    const clearEndTime = shouldClearProductionRunEndTime({
      from: transitionFrom,
      to: data.status,
      existingEndTime: productionRun?.endTime,
    });
    const runWindow = buildProductionRunWindow({
      startDateStr,
      startTimeStr: data.startTime as string,
      endDateStr,
      endTimeStr: data.endTime as string | undefined,
      includeEndTime,
      clearEndTime,
      timeZone: formTimezone,
    });
    if (!runWindow.ok) {
      setError(runWindow.field, { type: "validate", message: runWindow.message });
      return;
    }
    const combined: ProductionRunSubmitData = {
      ...data,
      expectedUpdatedAt: productionRun?.updatedAt,
      startTime: runWindow.startTime,
      endTime: runWindow.endTime,
    };

    // Clear any prior overlap state before re-submitting.
    setOverlapConflict(null);
    clearErrors("startTime");
    try {
      await onSubmit(combined);
    } catch (error) {
      const conflict = getRunConflict(error);
      if (conflict) {
        setError("startTime", {
          type: "server",
          message: error instanceof Error ? error.message : "Overlaps another run on this reactor",
        });
        setOverlapConflict(conflict);
        return;
      }
      throw error;
    }
  });

  return (
    <div className="space-y-20">
      <form id={formId} onSubmit={handleFormSubmit}>
      <ResolvedErrorRevalidator control={control} trigger={trigger} />
      <FormSpine control={control}>
      {/* ── Run setup ── */}
      <FormSection
        title="Run setup"
        icon={<FactoryIcon size={14} weight="bold" />}
        fields={["reactorId", "status", "cancellationReason", "startDate", "startTime", "endDate", "endTime", "operatorId"]}
      >

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

          <FormField
            id="status"
            label="Status"
            error={errors.status?.message}
            helperText="Mark finished runs Complete before certification."
            certifyRequired
            certifyStatus={runStatusCertStatus}
          >
            <FormSelect
              id="status"
              disabled={isSubmitting}
              error={!!errors.status}
              options={statusOptions}
              {...register("status")}
            />
          </FormField>
        </div>

        {watchedStatus === "cancelled" && (
          <FormField
            id="cancellationReason"
            label="Cancellation reason"
            error={errors.cancellationReason?.message}
            required
            helperText="Explain why this run did not take place."
          >
            <FormTextarea
              id="cancellationReason"
              rows={3}
              disabled={isSubmitting}
              error={!!errors.cancellationReason}
              {...register("cancellationReason")}
            />
          </FormField>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-16">
          <FormField
            id="startDate"
            label="Start date"
            error={errors.startDate?.message}
            helperText={timezoneHelperText}
            required
          >
            <FormInput id="startDate" type="date" disabled={isSubmitting} error={!!errors.startDate} {...register("startDate")} />
          </FormField>

          <FormField id="startTime" label="Start time" error={errors.startTime?.message} required>
            <FormInput
              id="startTime"
              type="time"
              disabled={isSubmitting}
              error={!!errors.startTime}
              {...register("startTime")}
            />
          </FormField>
        </div>

        {overlapConflict && watchedFacilityId && (
          <p className="body-caption text-[var(--color-text-secondary)]">
            <Link
              href={`/production-runs?facility=${watchedFacilityId}&run=${overlapConflict.id}`}
              className="text-[var(--clr-dark-purple)] underline"
            >
              Open {overlapConflict.code}
            </Link>{" "}
            to adjust its time window.
          </p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-16">
          <FormField
            id="endDate"
            label="End date"
            error={errors.endDate?.message}
            helperText="Leave the end blank until the run finishes. For an overnight run, set the next day."
          >
            <FormInput
              id="endDate"
              type="date"
              disabled={isSubmitting}
              error={!!errors.endDate}
              {...register("endDate")}
            />
          </FormField>

          <FormField id="endTime" label="End time" error={errors.endTime?.message}>
            <FormInput
              id="endTime"
              type="time"
              disabled={isSubmitting}
              error={!!errors.endTime}
              {...register("endTime")}
            />
          </FormField>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-16">
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
      </FormSection>

      {/* ── Feedstock & processing ── */}
      <FormSection
        title="Feedstock & processing"
        icon={<PlantIcon size={14} weight="bold" />}
        fields={[
          "feedstockDraws",
          "feedstockMoisturePercent",
          "feedingRateKgHr",
          "residenceTimeMinutes",
        ]}
        actions={
          <Button
            type="button"
            variant="default"
            size="small"
            onClick={() => appendFeedstockDraw({ ...EMPTY_FEEDSTOCK_DRAW })}
            disabled={isSubmitting || !watchedFacilityId}
          >
            <PlusIcon size={16} weight="bold" />
            Add source
          </Button>
        }
      >

        {!watchedFacilityId && (
          <p className="text-[var(--color-text-tertiary)] body-caption">
            Select a facility in the sidebar to choose a feedstock source bin.
          </p>
        )}
        {feedstockDrawFields.length === 0 && (
          <p className="body-small text-[var(--color-text-tertiary)] py-8">
            Add a source bin and the wet mass drawn from it.
          </p>
        )}
        <FormError
          id="feedstockDraws-error"
          message={errors.feedstockDraws?.message}
        />

        {feedstockDrawFields.map((drawField, index) => (
          <Controller
            key={drawField.id}
            name={`feedstockDraws.${index}.storageLocationId`}
            control={control}
            render={({ field: storageLocationField }) => (
              <Controller
                name={`feedstockDraws.${index}.wetMassKg`}
                control={control}
                render={({ field: wetMassField }) => (
                  <ProductionRunFeedstockDrawRow
                    index={index}
                    facilityId={watchedFacilityId}
                    productionRunId={productionRun?.id}
                    storageLocationId={storageLocationField.value}
                    wetMassKg={
                      typeof wetMassField.value === "number"
                        ? wetMassField.value
                        : null
                    }
                    selectedStorageLocationIds={watchedFeedstockDraws
                      .map((draw) => draw?.storageLocationId)
                      .filter((id): id is string => !!id)}
                    storageLocationError={
                      errors.feedstockDraws?.[index]?.storageLocationId?.message
                    }
                    wetMassError={
                      errors.feedstockDraws?.[index]?.wetMassKg?.message
                    }
                    disabled={isSubmitting}
                    onStorageLocationChange={storageLocationField.onChange}
                    onWetMassChange={wetMassField.onChange}
                    onStorageLocationBlur={storageLocationField.onBlur}
                    onWetMassBlur={wetMassField.onBlur}
                    storageLocationName={storageLocationField.name}
                    wetMassName={wetMassField.name}
                    storageLocationRef={storageLocationField.ref}
                    wetMassRef={wetMassField.ref}
                    onRemove={() => removeFeedstockDraw(index)}
                  />
                )}
              />
            )}
          />
        ))}

        {(selectedFeedstockDrawCount > 0 || watchWetMass > 0) && (
          <div className="border-l-2 border-[var(--color-border-primary)] bg-[var(--color-background-medium)] px-16 py-12">
            <p className="body-caption text-[var(--color-text-secondary)] flex items-center gap-6">
              Total wet input
              {isProductionRunCertifyField("feedstockWetMassKg") && (
                <CertificationFieldTag status={certStatus("feedstockWetMassKg")} />
              )}
            </p>
            <p className="body-small font-medium text-[var(--color-text-primary)] mt-2">
              {watchWetMass.toLocaleString("en-US", {
                maximumFractionDigits: FEEDSTOCK_MASS_MAX_FRACTION_DIGITS,
              })} kg from {selectedFeedstockDrawCount} {selectedFeedstockDrawCount === 1 ? "bin" : "bins"}
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <MoistureField
            id="feedstockMoisturePercent"
            materialLabel="Feedstock"
            error={errors.feedstockMoisturePercent?.message}
            disabled={isSubmitting}
            certifyRequired={isProductionRunCertifyField("feedstockMoisturePercent")}
            certifyStatus={certStatus("feedstockMoisturePercent")}
            registration={register("feedstockMoisturePercent", {
              setValueAs: nullableNumericValue,
            })}
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-16">
          <FormField id="feedingRateKgHr" label="Feed rate (kg/hr)" error={errors.feedingRateKgHr?.message}>
            <FormInput
              id="feedingRateKgHr"
              type="number"
              step="any"
              placeholder="e.g. 420"
              disabled={isSubmitting}
              error={!!errors.feedingRateKgHr}
              {...register("feedingRateKgHr", {
                setValueAs: nullableNumericValue,
              })}
            />
          </FormField>

          <FormField id="residenceTimeMinutes" label="Residence time (min)" error={errors.residenceTimeMinutes?.message}>
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
      </FormSection>

      {/* ── Output ── */}
      <FormSection
        title="Output"
        icon={<PackageIcon size={14} weight="bold" />}
        fields={[
          "biocharStorageLocationId",
          "biocharOutputKg",
          "biocharMoisturePercent",
        ]}
      >

        <FormField
          id="biocharStorageLocationId"
          label="Biochar storage bin"
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
                disabled={isSubmitting || !watchedFacilityId}
                error={!!errors.biocharStorageLocationId}
                filterBy={watchedFacilityId ? { facilityId: watchedFacilityId, type: "biochar_bin" } : undefined}
                allowCreate={!!watchedFacilityId}
                onCreateNew={() => biocharBinDialog.open()}
              />
            )}
          />
        </FormField>

        <MassMoistureFields
          materialLabel="Biochar"
          wetMassKg={watchedBiocharKg}
          moisturePercent={watchedBiocharMoisture}
          wet={{
            id: "biocharOutputKg",
            error: biocharOutputError,
            warning: massBalanceFeedback.wetWarning,
            disabled: isSubmitting,
            placeholder: "e.g. 150",
            certifyRequired: isProductionRunCertifyField("biocharOutputKg"),
            certifyStatus: certStatus("biocharOutputKg"),
            registration: register("biocharOutputKg", { setValueAs: nullableNumericValue }),
          }}
          moisture={{
            id: "biocharMoisturePercent",
            error: errors.biocharMoisturePercent?.message,
            disabled: isSubmitting,
            placeholder: "e.g. 1.5",
            certifyRequired: isProductionRunCertifyField("biocharMoisturePercent"),
            certifyStatus: certStatus("biocharMoisturePercent"),
            registration: register("biocharMoisturePercent", { setValueAs: nullableNumericValue }),
          }}
        />
      </FormSection>

      {/* ── Energy ── */}
      <FormSection
        title="Energy"
        icon={<LightningIcon size={14} weight="bold" />}
        fields={[
          "dieselOperationLiters",
          "dieselGensetLiters",
          "preprocessingFuelLiters",
          "electricityKwh",
        ]}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-16 gap-y-16">
          <FormField
            id="dieselOperationLiters"
            label="Startup / plant diesel (L)"
            hint="Diesel used for reactor startup and on-site plant equipment during this run. Do not include generator diesel."
            error={errors.dieselOperationLiters?.message}
            certifyRequired={isProductionRunCertifyField("dieselOperationLiters")}
            certifyStatus={certStatus("dieselOperationLiters")}
          >
            <FormInput
              id="dieselOperationLiters"
              type="number"
              step="any"
              placeholder="e.g. 50"
              disabled={isSubmitting}
              error={!!errors.dieselOperationLiters}
              {...register("dieselOperationLiters", {
                setValueAs: nullableNumericValue,
              })}
            />
          </FormField>

          <FormField
            id="dieselGensetLiters"
            label="Genset diesel (L)"
            hint="Diesel burned by the generator that supplied this run's electricity."
            error={errors.dieselGensetLiters?.message}
            certifyRequired={isProductionRunCertifyField("dieselGensetLiters")}
            certifyStatus={certStatus("dieselGensetLiters")}
          >
            <FormInput
              id="dieselGensetLiters"
              type="number"
              step="any"
              placeholder="e.g. 25"
              disabled={isSubmitting}
              error={!!errors.dieselGensetLiters}
              {...register("dieselGensetLiters", {
                setValueAs: nullableNumericValue,
              })}
            />
          </FormField>

          <FormField
            id="preprocessingFuelLiters"
            label="Preprocess fuel (L)"
            hint="Fuel used to dry, chip, or otherwise prepare the feedstock before pyrolysis."
            error={errors.preprocessingFuelLiters?.message}
            certifyRequired={isProductionRunCertifyField("preprocessingFuelLiters")}
            certifyStatus={certStatus("preprocessingFuelLiters")}
          >
            <FormInput
              id="preprocessingFuelLiters"
              type="number"
              step="any"
              placeholder="e.g. 10"
              disabled={isSubmitting}
              error={!!errors.preprocessingFuelLiters}
              {...register("preprocessingFuelLiters", {
                setValueAs: nullableNumericValue,
              })}
            />
          </FormField>

          <FormField
            id="electricityKwh"
            label="Electricity (kWh)"
            hint="Grid (or other non-generator) electricity consumed during this run."
            error={errors.electricityKwh?.message}
            certifyRequired={isProductionRunCertifyField("electricityKwh")}
            certifyStatus={certStatus("electricityKwh")}
          >
            <FormInput
              id="electricityKwh"
              type="number"
              step="any"
              placeholder="e.g. 100"
              disabled={isSubmitting}
              error={!!errors.electricityKwh}
              {...register("electricityKwh", {
                setValueAs: nullableNumericValue,
              })}
            />
          </FormField>
        </div>

      </FormSection>

      <ProductionReadingsField
        productionRunId={productionRun?.id}
        deferredAttachments={deferredAttachments}
        disabled={isSubmitting}
      />
      </FormSpine>

      {/* Process Flow — a derived recap of the run, not a data-entry step, so
          it lives outside the numbered spine and only appears once there's
          something to show. */}
      {(watchedReactorId || watchedSourceBinId || watchedDestBinId) && (
        <div className="space-y-12 border-t border-[var(--color-border-tertiary)] pt-20">
          <SectionLabel icon={<FlowArrowIcon size={14} weight="bold" />}>
            Process Flow
          </SectionLabel>
          <ProcessFlowPreview
            sourceBinName={sourceBinPreviewName}
            feedstockKg={watchWetMass}
            feedstockDryKg={previewDryMass}
            reactorName={selectedReactor?.name ?? null}
            biocharKg={typeof watchedBiocharKg === "number" ? watchedBiocharKg : null}
            biocharDryKg={previewBiocharDryMass}
            destinationBinName={selectedDestBin?.name ?? null}
          />
        </div>
      )}
      </form>

      {watchedFacilityId && (
        <StorageLocationQuickAddDialog
          isOpen={biocharBinDialog.isOpen}
          onClose={biocharBinDialog.close}
          onSuccess={(entity) => {
            setValue("biocharStorageLocationId", entity.id, SET_VALUE_OPTS);
            biocharBinDialog.close();
          }}
          defaultBinType="biochar_bin"
          allowedTypes={BIOCHAR_BIN_QUICK_ADD_TYPES}
          facilityId={watchedFacilityId}
        />
      )}

      {/* ── Extension content (e.g. readings/samples/incidents) — always before the CTA ── */}
      {children}

      <FormActions
        control={control}
        formId={formId}
        onCancel={onCancel}
        isSubmitting={isSubmitting}
        errorMessage={errorMessage}
        submitLabel={submitLabel}
        defaultSubmitLabel={defaultSubmitLabel}
      />
    </div>
  );
}
