/**
 * FeedstockForm component
 * Unified form combining delivery info + material + bin allocations.
 * Supports split deliveries (one truck → multiple bins) and
 * shows a dry mass warning when allocated > delivered.
 */
"use client";

import { useEffect, useId, useState } from "react";
import { useForm, useWatch, useFieldArray, type FieldError } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowCounterClockwiseIcon, CalendarIcon, MapPinIcon, NoteIcon, PlantIcon, PlusIcon, StackIcon } from "@phosphor-icons/react/dist/ssr";
import { numericValue } from "@/lib/form-utils";
import { isCertifyFormField } from "@/lib/certification/certify-field-registry";
import { toDateInputValue } from "@/lib/date-utils";
import { formatDistanceKm } from "@/lib/format-utils";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { useSupplier, useSupplierLocationsBySupplier } from "@/hooks/use-suppliers";
import { useTransportLegsForEntity } from "@/hooks/use-transport-legs";
import { FormField, FormInput, FormTextarea, FormEntitySelect, FormSection, FormSpine, MassMoistureFields, makeCertFieldStatus, resolveCertFieldStatus, type CertFieldStatus } from "@/components/forms";
import { ResolvedErrorRevalidator } from "@/components/forms";
import { FormActions } from "@/components/forms/form-actions";
import { Button } from "@/components/ui";
import {
  createFeedstockSchema,
  feedstockFormSchema,
  type FeedstockFormData,
} from "@/schemas/feedstocks";
import {
  DISTANCE_SOURCE_LABELS,
  type DistanceSourceValue,
} from "@/schemas/distance-source";
import { DEFAULT_TRIP_TYPE, roundTripDistanceFactor, TRIP_TYPE_OPTIONS, type TripTypeValue } from "@/schemas/trip-type";
import { FormSelect } from "@/components/forms/form-select";
import type { FeedstockWithRelations } from "@/data-access/feedstocks";
import type { UseDeferredAttachmentsResult } from "@/hooks/use-deferred-attachments";
import { VehicleQuickAddDialog } from "@/components/forms/entity-select/vehicle-quick-add-dialog";
import { FeedstockTypeQuickAddDialog } from "@/components/forms/entity-select/feedstock-type-quick-add-dialog";
import { StorageLocationQuickAddDialog } from "@/components/forms/entity-select/storage-location-quick-add-dialog";
import { useQuickAddDialog } from "@/components/forms/entity-select";
import { BinAllocationRow } from "./bin-allocation-row";
import { FeedstockEvidenceSection } from "./feedstock-trailing-sections";
import { WetMassWarning } from "./wet-mass-warning";
import { FEEDSTOCK_BIN_TYPES } from "@/schemas/storage-locations";
import { ActionableFocusTarget } from "@/components/ui/actionable-focus-target";
import type { EntityFocusTarget } from "@/lib/entity-deep-link";

const SET_VALUE_OPTS = { shouldDirty: true, shouldTouch: true, shouldValidate: true } as const;
const SUPPLIER_DEFAULT_DISTANCE_SOURCE = "supplier_default" as const;

const isFeedstockCertifyField = (field: string) =>
  isCertifyFormField("feedstock", field);

const FEEDSTOCK_ALLOCATION_BIN_TYPE_FILTER = FEEDSTOCK_BIN_TYPES.join(",");

type FeedstockDistanceSourceChoice =
  | typeof SUPPLIER_DEFAULT_DISTANCE_SOURCE
  | DistanceSourceValue;

// ============================================
// Component
// ============================================

interface FeedstockFormProps {
  /** Existing feedstock for editing (undefined = create mode) */
  feedstock?: FeedstockWithRelations;
  onSubmit: (data: FeedstockFormData) => Promise<void> | void;
  onCancel?: () => void;
  isSubmitting?: boolean;
  submitLabel?: string;
  serverError?: string;
  deferredAttachments?: UseDeferredAttachmentsResult;
  /** All rows a failed create produced, so evidence retry reaches each. */
  retryEntityIds?: string[];
  focusTarget?: EntityFocusTarget | null;
}

export function FeedstockForm({
  feedstock,
  onSubmit,
  onCancel,
  isSubmitting = false,
  submitLabel,
  serverError,
  deferredAttachments,
  retryEntityIds,
  focusTarget,
}: FeedstockFormProps) {
  const isEditMode = !!feedstock;
  const formId = useId();
  const { facilityId: contextFacilityId } = useFacilityContext();

  // Quick-add dialogs
  const vehicleDialog = useQuickAddDialog();
  const feedstockTypeDialog = useQuickAddDialog();
  const storageLocationDialog = useQuickAddDialog();
  const [storageLocationRowIndex, setStorageLocationRowIndex] = useState<number>(0);
  const [distanceSourceChoiceOverride, setDistanceSourceChoiceOverride] =
    useState<{
      supplierId: string;
      value: FeedstockDistanceSourceChoice;
    } | null>(null);

  const defaultValues = {
    facilityId: feedstock?.facilityId ?? contextFacilityId ?? "",
    // New records default to today. Legacy records without a delivery date
    // must stay empty in edit mode so the form matches read mode and a save
    // cannot silently introduce today's date.
    deliveryDate:
      feedstock && !feedstock.deliveryDate
        ? undefined
        : toDateInputValue(feedstock?.deliveryDate ?? null),
    supplierId: feedstock?.supplierId ?? "",
    vehicleId: feedstock?.vehicleId ?? "",
    transportDistanceKm: undefined as number | undefined,
    transportDistanceSource:
      feedstock?.transportDistanceSource ?? (null as DistanceSourceValue | null),
    transportTripType: DEFAULT_TRIP_TYPE as TripTypeValue,
    feedstockTypeId: feedstock?.feedstockTypeId ?? "",
    totalWetMassKg: feedstock?.massWetKg ?? ("" as unknown as number),
    moisturePercent: feedstock?.moistureContentPercent ?? ("" as unknown as number),
    allocations: feedstock
      ? [{ storageLocationId: feedstock.storageLocationId ?? "", allocatedWetMassKg: feedstock.massWetKg ?? 0 }]
      : [{ storageLocationId: "", allocatedWetMassKg: "" as unknown as number }],
    overrideJustification: feedstock?.overrideJustification ?? "",
    notes: feedstock?.notes ?? "",
  };

  const {
    register,
    handleSubmit,
    control,
    trigger,
    setValue,
    getValues,
    resetField,
    formState: { errors, dirtyFields },
  } = useForm({
    resolver: zodResolver(
      isEditMode ? feedstockFormSchema : createFeedstockSchema,
    ),
    // onTouched so spine markers can flag errors on blur, not only on submit.
    mode: "onTouched",
    defaultValues,
  });

  // CERT chips reflect the saved record (frozen), neutral while creating.
  const certStatus = makeCertFieldStatus(isEditMode ? defaultValues : undefined);

  // Cast control for FormEntitySelect compatibility (z.preprocess makes input types `unknown`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const formControl = control as any;

  const { fields, append, remove } = useFieldArray({
    control,
    name: "allocations",
  });

  // Watch values for dry mass calculation
  const watchWetMass = useWatch({ control, name: "totalWetMassKg" });
  const watchMoisture = useWatch({ control, name: "moisturePercent" });
  const watchAllocations = useWatch({ control, name: "allocations" });
  const watchedFacilityId = useWatch({ control, name: "facilityId" });
  const watchedFeedstockTypeId = useWatch({ control, name: "feedstockTypeId" });
  const watchedSupplierId = useWatch({ control, name: "supplierId" });
  const transportDistanceKm = useWatch({
    control,
    name: "transportDistanceKm",
  }) as number | null | undefined;
  const draftTransportDistanceSource = useWatch({
    control,
    name: "transportDistanceSource",
  }) as DistanceSourceValue | null | undefined;
  const transportTripType = useWatch({
    control,
    name: "transportTripType",
  }) as TripTypeValue | null | undefined;
  const totalTransportDistanceKm =
    transportTripType === "return" &&
    typeof transportDistanceKm === "number" &&
    Number.isFinite(transportDistanceKm) &&
    transportDistanceKm >= 0
      ? transportDistanceKm * roundTripDistanceFactor(transportTripType)
      : null;

  const defaultStorageBinType = "feedstock_bin";

  // Transport distance autofills from the existing leg (edit) or the stored
  // level — the supplier's DEFAULT location, else the supplier-level distance —
  // mirroring the server's priority resolution. The suggestion carries its
  // provenance along; hand-editing flips it to manual.
  const { data: selectedSupplier } = useSupplier(watchedSupplierId, !!watchedSupplierId);
  const { data: supplierLocationList } = useSupplierLocationsBySupplier(
    watchedSupplierId,
    !!watchedSupplierId,
  );
  const defaultSupplierLocation =
    supplierLocationList?.find((location) => location.isDefault) ?? null;
  const { data: existingLegs } = useTransportLegsForEntity("feedstock", feedstock?.id ?? "", {
    enabled: isEditMode,
  });
  const existingLegDistanceKm = existingLegs?.[0]?.distanceKm ?? null;
  // The transport distance lives on the derived leg, not in defaultValues (it's
  // autofilled async), so its CERT chip tracks whether the saved leg carries a
  // distance rather than the form field. While the leg query is in flight, stay
  // neutral so we never flash a misleading "missing" before it loads.
  const transportDistanceCertStatus: CertFieldStatus = resolveCertFieldStatus(
    !isEditMode || existingLegs === undefined ? undefined : true,
    existingLegDistanceKm != null,
  );
  const storedDistanceKm =
    defaultSupplierLocation?.distanceFromFacilityKm ??
    selectedSupplier?.distanceToFacilityKm ??
    null;
  const storedDistanceSource =
    defaultSupplierLocation?.distanceFromFacilityKm != null
      ? defaultSupplierLocation.distanceSource
      : (selectedSupplier?.distanceSource ?? null);
  const supplierAnchorChanged =
    isEditMode && watchedSupplierId !== feedstock?.supplierId;
  const suggestedDistanceKm = isEditMode && !supplierAnchorChanged
    ? existingLegDistanceKm ?? storedDistanceKm
    : storedDistanceKm;
  const suggestedDistanceSource =
    isEditMode && !supplierAnchorChanged && existingLegDistanceKm != null
      ? (existingLegs?.[0]?.distanceSource ?? null)
      : storedDistanceSource;
  const matchesSupplierDefault =
    storedDistanceKm != null &&
    transportDistanceKm === storedDistanceKm &&
    draftTransportDistanceSource === storedDistanceSource &&
    draftTransportDistanceSource !== "document";
  const selectedDistanceSource =
    distanceSourceChoiceOverride?.supplierId === watchedSupplierId
      ? distanceSourceChoiceOverride.value
      : matchesSupplierDefault
        ? SUPPLIER_DEFAULT_DISTANCE_SOURCE
        : (draftTransportDistanceSource ?? "");
  const distanceSourceOptions = [
    ...(storedDistanceKm != null
      ? [{ value: SUPPLIER_DEFAULT_DISTANCE_SOURCE, label: "Supplier default" }]
      : []),
    { value: "manual", label: DISTANCE_SOURCE_LABELS.manual },
    ...(selectedDistanceSource === "document"
      ? [{ value: "document", label: DISTANCE_SOURCE_LABELS.document }]
      : []),
  ];

  // The distance is an "override" once it diverges from the value we'd autofill
  // from the supplier/existing leg — that's the only state worth flagging (and
  // the only one we can reset back to).
  const isDistanceOverride =
    suggestedDistanceKm != null &&
    typeof transportDistanceKm === "number" &&
    transportDistanceKm !== suggestedDistanceKm;

  // Restore the autofilled distance and clear the field's dirty flag so the
  // prefill effect resumes managing it (e.g. on a later supplier switch).
  const resetTransportDistance = () => {
    const resetDistanceKm = storedDistanceKm ?? suggestedDistanceKm;
    const resetDistanceSource =
      storedDistanceKm != null ? storedDistanceSource : suggestedDistanceSource;
    if (storedDistanceKm != null) {
      setDistanceSourceChoiceOverride({
        supplierId: watchedSupplierId,
        value: SUPPLIER_DEFAULT_DISTANCE_SOURCE,
      });
    }
    resetField("transportDistanceKm", {
      defaultValue: resetDistanceKm ?? undefined,
    });
    resetField("transportDistanceSource", {
      defaultValue: resetDistanceSource ?? null,
    });
  };

  // Auto-set facility from context
  useEffect(() => {
    if (!feedstock && contextFacilityId && !watchedFacilityId) {
      setValue("facilityId", contextFacilityId);
    }
  }, [feedstock, contextFacilityId, watchedFacilityId, setValue]);

  // Prefill the distance (and its provenance) from the supplier/existing leg
  // unless the user edited it.
  useEffect(() => {
    if (suggestedDistanceKm != null) {
      if (!dirtyFields.transportDistanceKm) {
        setValue("transportDistanceKm", suggestedDistanceKm);
      }
      if (!dirtyFields.transportDistanceSource) {
        setValue("transportDistanceSource", suggestedDistanceSource);
      }
    } else {
      // Suggestion gone (e.g. switched to a supplier without a stored
      // distance) — clear the previous autofill so it can't persist.
      if (!dirtyFields.transportDistanceKm) {
        setValue("transportDistanceKm", undefined);
      }
      if (!dirtyFields.transportDistanceSource) {
        setValue("transportDistanceSource", null);
      }
    }
  }, [
    suggestedDistanceKm,
    suggestedDistanceSource,
    dirtyFields.transportDistanceKm,
    dirtyFields.transportDistanceSource,
    setValue,
  ]);

  // Prefill the saved leg's trip type in edit mode (async), unless the user
  // already changed it. New feedstock defaults to Return via defaultValues.
  const existingLegTripType = existingLegs?.[0]?.tripType ?? null;
  useEffect(() => {
    if (!isEditMode || dirtyFields.transportTripType) return;
    if (existingLegTripType) {
      setValue("transportTripType", existingLegTripType);
    }
  }, [isEditMode, existingLegTripType, dirtyFields.transportTripType, setValue]);

  // Sum of allocated wet mass
  const allocatedTotalWetKg = (watchAllocations ?? []).reduce((sum, a) => {
    const val = typeof a.allocatedWetMassKg === "number" ? a.allocatedWetMassKg : 0;
    return sum + val;
  }, 0);

  const showOverageWarning =
    typeof watchWetMass === "number" && allocatedTotalWetKg > watchWetMass;

  const defaultSubmitLabel = isEditMode ? "Update Feedstock" : "Create Feedstock";

  // A single bin holds the whole delivery, so its allocated wet mass mirrors the
  // total automatically — the operator never has to retype it. Mirroring stops
  // once they split across bins (fields.length > 1) or hand-edit the amount.
  useEffect(() => {
    if (isEditMode || fields.length !== 1 || typeof watchWetMass !== "number") {
      return;
    }
    if (dirtyFields.allocations?.[0]?.allocatedWetMassKg) return;
    if (getValues("allocations.0.allocatedWetMassKg") !== watchWetMass) {
      setValue("allocations.0.allocatedWetMassKg", watchWetMass, {
        shouldValidate: true,
      });
    }
  }, [fields.length, getValues, isEditMode, setValue, watchWetMass, dirtyFields.allocations]);

  const handleFormSubmit = handleSubmit((data) => {
    onSubmit(data as FeedstockFormData);
  });

  return (
    <>
      {/* The wrapper div absorbs the side-sheet Body's direct-child flex-col
          override so the sticky CTA row keeps its own layout (see sample-form). */}
      <div className="space-y-20">
      <FormSpine control={control}>
        <form id={formId} onSubmit={handleFormSubmit} className="space-y-20">
        <ResolvedErrorRevalidator control={control} trigger={trigger} />
        {/* Delivery Information */}
        <FormSection
          title="Delivery information"
          icon={<CalendarIcon size={14} weight="bold" />}
          fields={["facilityId", "deliveryDate", "supplierId"]}
        >
          {!contextFacilityId && !feedstock && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
              <FormEntitySelect
                control={formControl}
                name="facilityId"
                label="Facility"
                entityType="facility"
                placeholder="Select facility..."
                disabled={isSubmitting}
                required
              />
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
            <FormField
              id="deliveryDate"
              label="Delivery date"
              error={errors.deliveryDate?.message}
              required
            >
              <FormInput
                id="deliveryDate"
                type="date"
                disabled={isSubmitting}
                error={!!errors.deliveryDate}
                {...register("deliveryDate")}
              />
            </FormField>

            <FormEntitySelect
              control={formControl}
              name="supplierId"
              label="Supplier"
              entityType="supplier"
              placeholder="Select supplier..."
              disabled={isSubmitting}
              required
              // Suppliers are org-shared, so a lone one is not "the" supplier for
              // this delivery. Require an explicit pick (#379) — the default
              // auto-select-when-single would silently attribute the delivery and
              // cascade that supplier's transport distance.
              autoSelectSingle={false}
            />
          </div>
        </FormSection>

        {/* Transport Details */}
        <FormSection
          title="Transport details"
          icon={<MapPinIcon size={14} weight="bold" />}
          hint="One-way distance plus the delivery wet mass, recorded as one road transport leg."
          fields={[
            "vehicleId",
            "transportDistanceSource",
            "transportDistanceKm",
            "transportTripType",
          ]}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
            <div className="md:col-span-2">
              <FormEntitySelect
                control={formControl}
                name="vehicleId"
                label="Vehicle"
                entityType="vehicle"
                placeholder="Select vehicle..."
                disabled={isSubmitting}
                allowCreate
                alwaysShowSearch
                createLabel="Add new vehicle"
                onCreateNew={() => vehicleDialog.open()}
              />
            </div>

            <FormField
              id="transportDistanceSource"
              label="Distance source"
              error={errors.transportDistanceSource?.message}
            >
              <input
                type="hidden"
                {...register("transportDistanceSource")}
              />
              <FormSelect
                id="transportDistanceSource"
                name="transportDistanceSourceChoice"
                options={distanceSourceOptions}
                placeholder="Select source"
                disabled={isSubmitting || transportDistanceKm == null}
                error={!!errors.transportDistanceSource}
                value={selectedDistanceSource}
                onChange={(event) => {
                  if (
                    event.target.value === SUPPLIER_DEFAULT_DISTANCE_SOURCE &&
                    storedDistanceKm != null
                  ) {
                    setDistanceSourceChoiceOverride({
                      supplierId: watchedSupplierId,
                      value: SUPPLIER_DEFAULT_DISTANCE_SOURCE,
                    });
                    setValue(
                      "transportDistanceKm",
                      storedDistanceKm,
                      SET_VALUE_OPTS,
                    );
                    setValue(
                      "transportDistanceSource",
                      storedDistanceSource,
                      SET_VALUE_OPTS,
                    );
                    return;
                  }
                  const selectedSource =
                    event.target.value as DistanceSourceValue;
                  setDistanceSourceChoiceOverride({
                    supplierId: watchedSupplierId,
                    value: selectedSource,
                  });
                  setValue(
                    "transportDistanceSource",
                    selectedSource,
                    SET_VALUE_OPTS,
                  );
                }}
              />
            </FormField>

            <FormField
              id="transportTripType"
              label="Trip type"
              error={errors.transportTripType?.message}
              hint="Return counts the entered distance twice; One-way counts it once."
            >
              <FormSelect
                id="transportTripType"
                options={TRIP_TYPE_OPTIONS}
                disabled={isSubmitting}
                error={!!errors.transportTripType}
                {...register("transportTripType")}
              />
            </FormField>

            <ActionableFocusTarget
              target="transport-route"
              activeTarget={focusTarget}
              actionLabel="Complete the saved transport route information"
            >
              <FormField
                id="transportDistanceKm"
                label="Distance (km)"
                error={errors.transportDistanceKm?.message}
                certifyRequired={isFeedstockCertifyField("transportDistanceKm")}
                certifyStatus={transportDistanceCertStatus}
                helperText={
                  storedDistanceKm != null
                    ? "Supplier › facility distance, autofilled from the supplier. Override if the route differs."
                    : "Set a one-way distance on the supplier (or its default location) to autofill this."
                }
              >
                <div>
                  <div className="relative">
                    <FormInput
                      id="transportDistanceKm"
                      type="number"
                      step="any"
                      min="0"
                      placeholder="e.g., 85"
                      disabled={
                        isSubmitting ||
                        selectedDistanceSource === SUPPLIER_DEFAULT_DISTANCE_SOURCE
                      }
                      error={!!errors.transportDistanceKm}
                      className={isDistanceOverride ? "pr-[104px]" : undefined}
                      {...register("transportDistanceKm", {
                        setValueAs: numericValue,
                        onChange: (event) => {
                          setDistanceSourceChoiceOverride(
                            event.target.value === ""
                              ? null
                              : {
                                  supplierId: watchedSupplierId,
                                  value: "manual",
                                },
                          );
                          setValue(
                            "transportDistanceSource",
                            event.target.value === "" ? null : "manual",
                            SET_VALUE_OPTS,
                          );
                        },
                      })}
                    />
                    {isDistanceOverride && (
                      <button
                        type="button"
                        onClick={resetTransportDistance}
                        disabled={isSubmitting}
                        aria-label="Reset to suggested distance"
                        data-testid="transportDistanceKm-reset"
                        className="absolute inset-y-0 right-0 flex items-center gap-6 pl-8 pr-12 text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-secondary)] disabled:opacity-50"
                      >
                        <span className="body-caption">reset</span>
                        <ArrowCounterClockwiseIcon size={14} weight="bold" />
                      </button>
                    )}
                  </div>
                  {totalTransportDistanceKm != null && (
                    <p
                      className="body-caption text-[var(--color-text-tertiary)] mt-6"
                      data-testid="transport-distance-total"
                      aria-live="polite"
                    >
                      Total: {formatDistanceKm(totalTransportDistanceKm)}
                    </p>
                  )}
                </div>
              </FormField>
            </ActionableFocusTarget>
          </div>
        </FormSection>

        {/* Material Details */}
        <FormSection
          title="Material"
          icon={<PlantIcon size={14} weight="bold" />}
          fields={["feedstockTypeId", "totalWetMassKg", "moisturePercent"]}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
            <FormEntitySelect
              control={formControl}
              name="feedstockTypeId"
              label="Feedstock type"
              entityType="feedstockType"
              placeholder="Select feedstock type..."
              disabled={isSubmitting}
              required
              allowCreate
              createLabel="Add new feedstock type"
              onCreateNew={() => feedstockTypeDialog.open()}
              filterBy={{ usage: "pyrolysis" }}
              hideSearch
            />
          </div>

          <MassMoistureFields
            wetMassKg={watchWetMass}
            moisturePercent={watchMoisture}
            wet={{
              id: "totalWetMassKg",
              label: "Total wet mass (kg)",
              error: errors.totalWetMassKg?.message,
              hint: "As-received weight of the entire delivery, water included.",
              required: true,
              disabled: isSubmitting,
              placeholder: "e.g. 1500",
              certifyRequired: isFeedstockCertifyField("totalWetMassKg"),
              certifyStatus: certStatus("totalWetMassKg"),
              registration: register("totalWetMassKg", { setValueAs: numericValue }),
            }}
            moisture={{
              id: "moisturePercent",
              error: errors.moisturePercent?.message,
              required: true,
              disabled: isSubmitting,
              placeholder: "e.g. 35",
              registration: register("moisturePercent", { setValueAs: numericValue }),
            }}
          />
        </FormSection>

        {/* Bin Allocations — only shown after feedstock type is selected */}
        {watchedFeedstockTypeId ? (
          <FormSection
            title="Bin allocations"
            icon={<StackIcon size={14} weight="bold" />}
            actions={
              !isEditMode && (
                <Button
                  type="button"
                  variant="default"
                  size="small"
                  onClick={() => append({ storageLocationId: "", allocatedWetMassKg: 0 })}
                  disabled={isSubmitting}
                >
                  <PlusIcon size={16} weight="bold" />
                  Add Bin
                </Button>
              )
            }
          >
            {errors.allocations?.message && (
              <p className="body-small text-[var(--color-status-error)]">{errors.allocations.message}</p>
            )}

            <div className="space-y-12">
              {fields.map((field, index) => (
                <BinAllocationRow
                  key={field.id}
                  index={index}
                  control={formControl}
                  massRegister={register(`allocations.${index}.allocatedWetMassKg`, { setValueAs: numericValue })}
                  massError={errors.allocations?.[index]?.allocatedWetMassKg as FieldError | undefined}
                  canRemove={fields.length > 1}
                  onRemove={() => remove(index)}
                  disabled={isSubmitting}
                  binTypeFilter={FEEDSTOCK_ALLOCATION_BIN_TYPE_FILTER}
                  facilityId={watchedFacilityId || undefined}
                  feedstockTypeId={watchedFeedstockTypeId || undefined}
                  onCreateNew={() => {
                    setStorageLocationRowIndex(index);
                    storageLocationDialog.open();
                  }}
                />
              ))}
            </div>

            {/* Allocation summary */}
            {fields.length > 1 && (
              <div className="flex items-center gap-12 border border-[var(--color-border-tertiary)] bg-[var(--color-background-medium)] px-16 py-12">
                <span className="body-small text-[var(--color-text-tertiary)]">Total Allocated</span>
                <span className="body-medium font-medium text-[var(--color-text-primary)]">
                  {allocatedTotalWetKg.toFixed(2)} kg
                </span>
                {typeof watchWetMass === "number" && (
                  <span className="body-small text-[var(--color-text-tertiary)]">
                    of {watchWetMass.toFixed(2)} kg delivered
                  </span>
                )}
              </div>
            )}

            {/* Overage warning */}
            {showOverageWarning && (
              <WetMassWarning
                allocatedKg={allocatedTotalWetKg}
                deliveredKg={watchWetMass as number}
                justificationRegister={register("overrideJustification")}
                justificationError={errors.overrideJustification?.message}
                disabled={isSubmitting}
              />
            )}
          </FormSection>
        ) : null}

        {/* Documentation */}
        <FormSection
          title="Documentation"
          icon={<NoteIcon size={14} weight="bold" />}
          fields={["notes"]}
        >
          <div className="grid grid-cols-1 gap-y-20">
            <FormField
              id="notes"
              label="Notes"
              error={errors.notes?.message}
              helperText="Delivery notes, weighbridge tickets, or supplier references"
            >
              <FormTextarea
                id="notes"
                placeholder="Enter delivery note IDs, weighbridge tickets, supplier batch references..."
                disabled={isSubmitting}
                error={!!errors.notes}
                rows={3}
                {...register("notes")}
              />
            </FormField>
          </div>
        </FormSection>

        </form>

        <FeedstockEvidenceSection
          feedstock={feedstock}
          isEditMode={isEditMode}
          deferredAttachments={deferredAttachments}
          retryEntityIds={retryEntityIds}
          isSubmitting={isSubmitting}
          focusTarget={focusTarget}
        />
      </FormSpine>

      <FormActions
        formId={formId}
        onCancel={onCancel}
        isSubmitting={isSubmitting}
        errorMessage={serverError}
        submitLabel={submitLabel}
        defaultSubmitLabel={defaultSubmitLabel}
        // The update path rebuilds the derived transport leg from the
        // submitted values, so saving before the saved leg has prefilled
        // trip type/distance would silently reset them to defaults.
        submitDisabled={isEditMode && existingLegs === undefined}
      />
      </div>

      {/* Quick-add dialogs */}
      <VehicleQuickAddDialog
        isOpen={vehicleDialog.isOpen}
        onClose={vehicleDialog.close}
        onSuccess={(vehicle) => {
          setValue("vehicleId", vehicle.id, SET_VALUE_OPTS);
          vehicleDialog.close();
        }}
      />

      <FeedstockTypeQuickAddDialog
        isOpen={feedstockTypeDialog.isOpen}
        onClose={feedstockTypeDialog.close}
        onSuccess={(feedstockType) => {
          setValue("feedstockTypeId", feedstockType.id, SET_VALUE_OPTS);
          feedstockTypeDialog.close();
        }}
        defaultUsage="pyrolysis"
      />

      {watchedFacilityId && (
        <StorageLocationQuickAddDialog
          isOpen={storageLocationDialog.isOpen}
          onClose={storageLocationDialog.close}
          onSuccess={(entity) => {
            setValue(`allocations.${storageLocationRowIndex}.storageLocationId`, entity.id, SET_VALUE_OPTS);
            storageLocationDialog.close();
          }}
          defaultBinType={defaultStorageBinType}
          allowedTypes={FEEDSTOCK_BIN_TYPES}
          defaultFeedstockTypeId={watchedFeedstockTypeId || undefined}
          feedstockTypeUsage="pyrolysis"
          facilityId={watchedFacilityId}
        />
      )}
    </>
  );
}
