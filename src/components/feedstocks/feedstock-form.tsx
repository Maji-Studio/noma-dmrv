/**
 * FeedstockForm component
 * Unified form combining delivery info + material + bin allocations.
 * Supports split deliveries (one truck → multiple bins) and
 * shows a dry mass warning when allocated > delivered.
 */
"use client";

import type { ReactNode } from "react";
import { useEffect, useId, useState } from "react";
import { useForm, useWatch, useFieldArray, type FieldError } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowCounterClockwiseIcon, CalendarIcon, MapPinIcon, NoteIcon, PlantIcon, PlusIcon, StackIcon } from "@phosphor-icons/react/dist/ssr";
import { numericValue } from "@/lib/form-utils";
import { isCertifyFormField } from "@/lib/certification/certify-field-registry";
import { toDateInputValue } from "@/lib/date-utils";
import { ONE_WAY_CUE } from "@/lib/format-utils";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { useSupplier, useSupplierLocationsBySupplier } from "@/hooks/use-suppliers";
import { useTransportLegsForEntity } from "@/hooks/use-transport-legs";
import { ControlUnitSuffix, unitEndPadding } from "@/components/forms/form-field";
import { DISTANCE_UNIT } from "@/components/forms/distance-calc-field";
import { FormError, FormField, FormInput, FormTextarea, FormEntitySelect, FormSection, FormSpine, MassMoistureFields, makeCertFieldStatus, resolveCertFieldStatus, type CertFieldStatus } from "@/components/forms";
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
import { FormSelect } from "@/components/forms/form-select";
import type { FeedstockWithRelations } from "@/data-access/feedstocks";
import type { UseDeferredAttachmentsResult } from "@/hooks/use-deferred-attachments";
import { VehicleQuickAddDialog } from "@/components/forms/entity-select/vehicle-quick-add-dialog";
import { FeedstockTypeQuickAddDialog } from "@/components/forms/entity-select/feedstock-type-quick-add-dialog";
import { StorageLocationQuickAddDialog } from "@/components/forms/entity-select/storage-location-quick-add-dialog";
import {
  SupplierQuickAddDialog,
  useQuickAddDialog,
} from "@/components/forms/entity-select";
import { BinAllocationRow } from "./bin-allocation-row";
import { FeedstockEvidenceSection } from "./feedstock-trailing-sections";
import { WetMassWarning } from "./wet-mass-warning";
import { FeedstockAllocationSummary } from "./feedstock-allocation-summary";
import { FEEDSTOCK_BIN_TYPES } from "@/schemas/storage-locations";
import { exceedsMassWithTolerance } from "@/lib/calculations/mass-dry";
import { ActionableFocusTarget } from "@/components/ui/actionable-focus-target";
import { TransportRoutePreview } from "@/components/transport-legs";
import { useFacility } from "@/hooks/use-facilities";
import type { EntityFocusTarget } from "@/lib/entity-deep-link";
import { matchesSupplierDefaultForDisplay } from "./feedstock-distance-source";

const SET_VALUE_OPTS = { shouldDirty: true, shouldTouch: true, shouldValidate: true } as const;
const SUPPLIER_DEFAULT_DISTANCE_SOURCE = "supplier_default" as const;
const DISTANCE_INPUT_STYLE = { paddingInlineEnd: unitEndPadding(DISTANCE_UNIT) } as const;

const isFeedstockCertifyField = (field: string) =>
  isCertifyFormField("feedstock", field);

const ROUTE_EMPTY = "Select a supplier and enter the wet mass to see the route.";

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
  /** Rendered under `serverError`: detail about the records the refusal named. */
  serverErrorAction?: ReactNode;
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
  serverErrorAction,
  deferredAttachments,
  retryEntityIds,
  focusTarget,
}: FeedstockFormProps) {
  const isEditMode = !!feedstock;
  // Returning to the saved mass clears RHF dirtiness, but is still an override.
  const [hasEditedAllocationMass, setHasEditedAllocationMass] = useState(false);
  const formId = useId();
  const { facilityId: contextFacilityId } = useFacilityContext();

  // Quick-add dialogs
  const vehicleDialog = useQuickAddDialog();
  const feedstockTypeDialog = useQuickAddDialog();
  const storageLocationDialog = useQuickAddDialog();
  const supplierDialog = useQuickAddDialog();
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
    feedstockTypeId: feedstock?.feedstockTypeId ?? "",
    totalWetMassKg: feedstock?.massWetKg ?? undefined as number | undefined,
    moisturePercent: feedstock?.moistureContentPercent ?? undefined as number | undefined,
    // An allocation mass the record does not have stays blank, never 0: the
    // schema requires a positive mass, so seeding 0 would prefill a value that
    // fails submit on a `missing_data` record with no wet mass yet.
    allocations: feedstock
      ? [
          {
            storageLocationId: feedstock.storageLocationId ?? "",
            allocatedWetMassKg: feedstock.massWetKg ?? undefined as number | undefined,
          },
        ]
      : [{ storageLocationId: "", allocatedWetMassKg: undefined as number | undefined }],
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
  // The one-way entry as a number; the route preview adds the round trip.
  const oneWayTransportDistanceKm =
    typeof transportDistanceKm === "number" &&
    Number.isFinite(transportDistanceKm) &&
    transportDistanceKm >= 0
      ? transportDistanceKm
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
  const { data: watchedFacility } = useFacility(watchedFacilityId ?? "");
  // Same rule as the saved leg (syncFeedstockTransportLeg): the default
  // location's coordinates when it has both, else the supplier's.
  const supplierRoutePoint =
    defaultSupplierLocation?.gpsLatitude != null && defaultSupplierLocation.gpsLongitude != null
      ? { lat: defaultSupplierLocation.gpsLatitude, lng: defaultSupplierLocation.gpsLongitude }
      : { lat: selectedSupplier?.gpsLatitude, lng: selectedSupplier?.gpsLongitude };
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
  // A saved leg's provenance is authoritative: in edit mode with an existing
  // leg, the select shows the persisted source verbatim and never relabels it
  // "Supplier default" on a numeric coincidence (DR-002 / FS-26-001).
  const matchesSupplierDefault = matchesSupplierDefaultForDisplay({
    seededFromSavedLeg:
      isEditMode && !supplierAnchorChanged && existingLegDistanceKm != null,
    storedDistanceKm,
    storedDistanceSource,
    transportDistanceKm,
    draftTransportDistanceSource,
  });
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
    // Read-only provenance values stay selectable-in-place so the persisted
    // source renders instead of a blank select.
    ...(selectedDistanceSource === "map_estimate"
      ? [{ value: "map_estimate", label: DISTANCE_SOURCE_LABELS.map_estimate }]
      : []),
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

  // Sum of allocated wet mass
  const allocatedTotalWetKg = (watchAllocations ?? []).reduce((sum, a) => {
    const val =
      typeof a.allocatedWetMassKg === "number" &&
      Number.isFinite(a.allocatedWetMassKg)
        ? a.allocatedWetMassKg
        : 0;
    return sum + val;
  }, 0);
  const deliveredWetMassKg =
    typeof watchWetMass === "number" && Number.isFinite(watchWetMass)
      ? watchWetMass
      : null;

  const showOverageWarning =
    deliveredWetMassKg != null &&
    exceedsMassWithTolerance(allocatedTotalWetKg, deliveredWetMassKg);

  const defaultSubmitLabel = isEditMode ? "Update feedstock" : "Create feedstock";

  // A single bin holds the whole delivery, so its allocated wet mass mirrors the
  // total automatically in create and edit mode. Mirroring stops
  // once they split across bins (fields.length > 1) or hand-edit the amount.
  useEffect(() => {
    if (fields.length !== 1 || typeof watchWetMass !== "number") {
      return;
    }
    if (dirtyFields.allocations?.[0]?.allocatedWetMassKg) return;
    if (isEditMode && hasEditedAllocationMass) return;
    if (getValues("allocations.0.allocatedWetMassKg") !== watchWetMass) {
      setValue("allocations.0.allocatedWetMassKg", watchWetMass, {
        shouldValidate: true,
      });
    }
  }, [fields.length, getValues, hasEditedAllocationMass, isEditMode, setValue, watchWetMass, dirtyFields.allocations]);

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
              allowCreate
              onCreateNew={supplierDialog.open}
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

            <ActionableFocusTarget
              target="transport-route"
              activeTarget={focusTarget}
              actionLabel="Complete the saved transport route information"
            >
              <FormField
                id="transportDistanceKm"
                label="Distance"
                labelUnit={DISTANCE_UNIT}
                error={errors.transportDistanceKm?.message}
                certifyRequired={isFeedstockCertifyField("transportDistanceKm")}
                certifyStatus={transportDistanceCertStatus}
                helperText={
                  storedDistanceKm != null
                    ? "Autofilled from the supplier. Override if this delivery took a different route."
                    : "Set a one-way distance on the supplier (or its default location) to autofill this."
                }
              >
                <div>
                  <div className="flex items-stretch gap-6">
                  <div className="relative grow">
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
                      className="peer w-full"
                      style={DISTANCE_INPUT_STYLE}
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
                    <ControlUnitSuffix unit={DISTANCE_UNIT} />
                  </div>
                    {isDistanceOverride && (
                      <button
                        type="button"
                        onClick={resetTransportDistance}
                        disabled={isSubmitting}
                        aria-label="Reset to suggested distance"
                        data-testid="transportDistanceKm-reset"
                        className="flex shrink-0 items-center gap-6 px-8 text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-secondary)] disabled:opacity-50"
                      >
                        <span className="body-caption">reset</span>
                        <ArrowCounterClockwiseIcon size={14} weight="bold" />
                      </button>
                    )}
                  </div>
                  {/* The route below shows the round trip this distance counts. */}
                  <p className="body-caption text-[var(--color-text-tertiary)] mt-6">
                    {ONE_WAY_CUE}
                  </p>
                </div>
              </FormField>
            </ActionableFocusTarget>
          </div>
          {/* Origin mirrors the saved leg: the supplier's default location, else the supplier. */}
          <TransportRoutePreview
            entityType="feedstock"
            originName={defaultSupplierLocation?.name ?? selectedSupplier?.name}
            originPoint={supplierRoutePoint}
            destinationPoint={{ lat: watchedFacility?.gpsLatitude ?? null, lng: watchedFacility?.gpsLongitude ?? null }}
            destinationName={watchedFacility?.name}
            distanceKm={oneWayTransportDistanceKm}
            distanceSource={draftTransportDistanceSource}
            loadMassKg={typeof watchWetMass === "number" ? watchWetMass : null}
            saved={isEditMode}
            emptyMessage={ROUTE_EMPTY}
          />
        </FormSection>

        {/* Material Details */}
        <FormSection
          title="Material"
          icon={<PlantIcon size={14} weight="bold" />}
          fields={["feedstockTypeId", "totalWetMassKg", "moisturePercent"]}
        >
          <div className="grid grid-cols-1 gap-x-16 gap-y-20">
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
              hideSearch
            />
          </div>

          <MassMoistureFields
            materialLabel="Feedstock"
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
                  onClick={() =>
                    append({
                      storageLocationId: "",
                      allocatedWetMassKg: undefined as number | undefined,
                    })
                  }
                  disabled={isSubmitting}
                >
                  <PlusIcon size={16} weight="bold" />
                  Add bin
                </Button>
              )
            }
          >
            <FormError id="allocations-error" message={errors.allocations?.message} />

            <div className="space-y-12">
              {fields.map((field, index) => (
                <BinAllocationRow
                  key={field.id}
                  index={index}
                  control={formControl}
                  massRegister={register(`allocations.${index}.allocatedWetMassKg`, {
                    setValueAs: numericValue,
                    onChange: () => {
                      if (isEditMode) setHasEditedAllocationMass(true);
                    },
                  })}
                  massError={errors.allocations?.[index]?.allocatedWetMassKg as FieldError | undefined}
                  canRemove={fields.length > 1}
                  onRemove={() => remove(index)}
                  disabled={isSubmitting}
                  binTypeFilter={FEEDSTOCK_ALLOCATION_BIN_TYPE_FILTER}
                  facilityId={watchedFacilityId || undefined}
                  feedstockTypeId={watchedFeedstockTypeId || undefined}
                  // The quick-add dialog needs a facility to create the bin in.
                  onCreateNew={
                    watchedFacilityId
                      ? () => {
                          setStorageLocationRowIndex(index);
                          storageLocationDialog.open();
                        }
                      : undefined
                  }
                />
              ))}
            </div>

            {/* Allocation summary */}
            {fields.length > 1 && (
              <FeedstockAllocationSummary
                allocatedKg={allocatedTotalWetKg}
                deliveredKg={deliveredWetMassKg}
              />
            )}

            {/* Overage warning */}
            {showOverageWarning && deliveredWetMassKg != null && (
              <WetMassWarning
                allocatedKg={allocatedTotalWetKg}
                deliveredKg={deliveredWetMassKg}
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
        control={control}
        formId={formId}
        onCancel={onCancel}
        isSubmitting={isSubmitting}
        errorMessage={serverError}
        errorAction={serverErrorAction}
        submitLabel={submitLabel}
        defaultSubmitLabel={defaultSubmitLabel}
        // The update path rebuilds the derived transport leg from the
        // submitted values, so saving before the saved leg has prefilled its
        // distance would silently reset it to the supplier default.
        submitDisabled={isEditMode && existingLegs === undefined}
      />
      </div>

      {/* Quick-add dialogs */}
      <SupplierQuickAddDialog
        isOpen={supplierDialog.isOpen}
        onClose={supplierDialog.close}
        onSuccess={(supplier) => {
          setValue("supplierId", supplier.id, SET_VALUE_OPTS);
          supplierDialog.close();
        }}
      />

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
          facilityId={watchedFacilityId}
        />
      )}
    </>
  );
}
