/**
 * FeedstockForm component
 * Unified form combining delivery info + material + bin allocations.
 * Supports split deliveries (one truck → multiple bins) and
 * shows a dry mass warning when allocated > delivered.
 */
"use client";

import { INTAKE_MOISTURE_RANGE_HELPER } from "@/lib/mass-moisture";
import type { ReactNode } from "react";
import { useEffect, useId, useState } from "react";
import { useForm, useWatch, useFieldArray, type FieldError } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CalendarIcon, MapPinIcon, NoteIcon, PlantIcon, PlusIcon, StackIcon } from "@phosphor-icons/react/dist/ssr";
import { nullableNumericValue, numericValue } from "@/lib/form-utils";
import { isCertifyFormField } from "@/lib/certification/certify-field-registry";
import { toDateInputValue } from "@/lib/date-utils";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { useSupplier, useSupplierLocationsBySupplier } from "@/hooks/use-suppliers";
import { useTransportLegsForEntity } from "@/hooks/use-transport-legs";
import { FormError, FormField, FormInput, FormTextarea, FormEntitySelect, FormSection, FormSpine, MassMoistureFields, makeCertFieldStatus, resolveCertFieldStatus, type CertFieldStatus } from "@/components/forms";
import { ResolvedErrorRevalidator } from "@/components/forms";
import { FormActions } from "@/components/forms/form-actions";
import { Button } from "@/components/ui";
import {
  createFeedstockSchema,
  feedstockFormSchema,
  type FeedstockFormData,
} from "@/schemas/feedstocks";
import type { DistanceSourceValue } from "@/schemas/distance-source";
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
import { DistanceOverrideField } from "@/components/transport-legs/distance-override-field";
import { distanceOverridePatch, emptyToNullSource, hasSavedOverride, overrideDistanceError } from "@/components/transport-legs/distance-override";
import { useClearOnDependencyChange } from "@/hooks/use-clear-on-dependency-change";
import { supplierLocationDistanceLink } from "@/lib/location-distance-links";

const SET_VALUE_OPTS = { shouldDirty: true, shouldTouch: true, shouldValidate: true } as const;

const isFeedstockCertifyField = (field: string) =>
  isCertifyFormField("feedstock", field);

const ROUTE_EMPTY = "Select a supplier and enter the wet mass to see the route.";

const FEEDSTOCK_ALLOCATION_BIN_TYPE_FILTER = FEEDSTOCK_BIN_TYPES.join(",");

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

  const defaultValues = {
    facilityId: feedstock?.facilityId ?? contextFacilityId ?? "",
    deliveryDate: toDateInputValue(feedstock?.deliveryDate ?? null),
    supplierId: feedstock?.supplierId ?? "",
    vehicleId: feedstock?.vehicleId ?? "",
    distanceNote: feedstock?.distanceNote ?? "",
    // Only an override is a form value; a derived distance stays on the leg.
    transportDistanceKm: (feedstock?.distanceKmOverride ?? null) as number | null,
    transportDistanceSource: (feedstock?.distanceKmOverride != null ? feedstock.distanceSource : null) as DistanceSourceValue | null,
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
    setError,
    clearErrors,
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

  // The derived distance comes from the supplier's default location and the
  // facility; an override is the operator's own value (GLOSSARY).
  const { data: selectedSupplier } = useSupplier(watchedSupplierId, !!watchedSupplierId);
  const { data: supplierLocationList } = useSupplierLocationsBySupplier(
    watchedSupplierId,
    !!watchedSupplierId,
  );
  const defaultSupplierLocation =
    supplierLocationList?.find((location) => location.isDefault) ?? null;
  const { data: watchedFacility } = useFacility(watchedFacilityId ?? "");
  // Same rule as the saved leg (syncFeedstockTransportLeg): the default
  // location supplies the coordinates.
  const supplierRoutePoint =
    defaultSupplierLocation?.gpsLatitude != null && defaultSupplierLocation.gpsLongitude != null
      ? { lat: defaultSupplierLocation.gpsLatitude, lng: defaultSupplierLocation.gpsLongitude }
      : { lat: undefined, lng: undefined };
  const { data: existingLegs } = useTransportLegsForEntity("feedstock", feedstock?.id ?? "", {
    enabled: isEditMode,
  });
  const existingLegDistanceKm = existingLegs?.[0]?.distanceKm ?? null;
  // The CERT chip tracks the saved leg's distance. While the leg query is in
  // flight, stay neutral so we never flash a misleading "missing".
  const transportDistanceCertStatus: CertFieldStatus = resolveCertFieldStatus(
    !isEditMode || existingLegs === undefined ? undefined : true,
    existingLegDistanceKm != null,
  );
  const facilityDistance = defaultSupplierLocation?.facilityDistances.find(row => row.facilityId === watchedFacilityId);
  const pairDistance = {
    distanceKm: facilityDistance?.distanceKm ?? null,
    source: facilityDistance?.distanceSource ?? null,
  };
  const routeAnchorChanged = isEditMode &&
    (watchedSupplierId !== feedstock?.supplierId || watchedFacilityId !== feedstock?.facilityId);
  // A saved derived leg keeps its recorded distance; clearing an override, or
  // moving the route, derives from the current pair instead.
  const savedOverride = feedstock
    ? { distanceKm: feedstock.distanceKmOverride, source: feedstock.distanceSource, note: feedstock.distanceNote }
    : null;
  const [overriding, setOverriding] = useState(hasSavedOverride(savedOverride));
  const usesSavedLeg = isEditMode && !routeAnchorChanged && !hasSavedOverride(savedOverride);
  const derivedFromLeg = usesSavedLeg && existingLegDistanceKm != null;
  const derivedDistance = derivedFromLeg
    ? { distanceKm: existingLegDistanceKm, source: existingLegs?.[0]?.distanceSource ?? null }
    : pairDistance;
  // Claim nothing while the saved leg or the supplier's locations load.
  const derivedPending = (usesSavedLeg && existingLegs === undefined) ||
    (!derivedFromLeg && !!watchedSupplierId && supplierLocationList === undefined);
  const effectiveDistance = overriding
    ? { distanceKm: oneWayTransportDistanceKm, source: draftTransportDistanceSource ?? null }
    : derivedPending ? { distanceKm: null, source: null } : derivedDistance;
  const supplierLocationRepairHref = watchedSupplierId && watchedFacilityId
    ? supplierLocationDistanceLink({ facilityId: watchedFacilityId, partyId: watchedSupplierId, locationId: defaultSupplierLocation?.id })
    : null;

  const startOverride = () => {
    setOverriding(true);
    setValue("transportDistanceKm", null, SET_VALUE_OPTS);
    setValue("transportDistanceSource", "manual", { shouldDirty: true });
  };
  const clearOverride = () => {
    setOverriding(false);
    clearErrors(["transportDistanceKm", "transportDistanceSource", "distanceNote"]);
    setValue("transportDistanceKm", null, { shouldDirty: true });
    setValue("transportDistanceSource", null, { shouldDirty: true });
    setValue("distanceNote", "", { shouldDirty: true });
  };
  // A new supplier or facility is a new route: its override no longer applies.
  useClearOnDependencyChange([watchedSupplierId, watchedFacilityId], () => {
    if (overriding) clearOverride();
  });

  // Auto-set facility from context
  useEffect(() => {
    if (!feedstock && contextFacilityId && !watchedFacilityId) {
      setValue("facilityId", contextFacilityId);
    }
  }, [feedstock, contextFacilityId, watchedFacilityId, setValue]);

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
    const submitted = {
      overriding,
      distanceKm: data.transportDistanceKm,
      source: data.transportDistanceSource,
      note: data.distanceNote,
    };
    const overrideError = overrideDistanceError(submitted);
    if (overrideError) {
      setError("transportDistanceKm", { type: "manual", message: overrideError }, { shouldFocus: true });
      return;
    }
    // A new supplier or facility is a new route: the saved override is no baseline.
    const patch = distanceOverridePatch(savedOverride, submitted, {
      routeChanged: isEditMode && (data.supplierId !== feedstock.supplierId || data.facilityId !== feedstock.facilityId),
    });
    onSubmit({
      ...data,
      transportDistanceKm: patch.distanceKm,
      transportDistanceSource: patch.source,
      distanceNote: patch.note,
    } as FeedstockFormData);
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
            <div className="grid grid-cols-1 gap-x-16 gap-y-20">
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

          <div className="grid grid-cols-1 gap-x-16 gap-y-20">
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
              allowEdit
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
            "transportDistanceKm",
            "transportDistanceSource",
            "distanceNote",
          ]}
        >
          <div className="grid grid-cols-1 gap-x-16 gap-y-20">
            <div>
              <FormEntitySelect
                control={formControl}
                name="vehicleId"
                label="Vehicle"
                entityType="vehicle"
                allowEdit
                placeholder="Select vehicle..."
                disabled={isSubmitting}
                allowCreate
                alwaysShowSearch
                createLabel="Add new vehicle"
                onCreateNew={() => vehicleDialog.open()}
              />
            </div>

            <ActionableFocusTarget
              target="transport-route"
              activeTarget={focusTarget}
              actionLabel="Complete the saved transport route information"
            >
              <DistanceOverrideField
                id="transportDistanceKm"
                sourceId="transportDistanceSource"
                noteId="distanceNote"
                hint="The one-way distance from the supplier's default location to this facility. Override it when this delivery took a different route."
                overriding={overriding}
                onOverride={startOverride}
                onClear={clearOverride}
                derived={derivedDistance}
                pending={derivedPending}
                locationName={defaultSupplierLocation?.name ?? selectedSupplier?.name ?? null}
                awaitingMessage={watchedSupplierId ? null : "Select a supplier to load its location distance."}
                repairHref={supplierLocationRepairHref}
                distanceRegistration={register("transportDistanceKm", { setValueAs: nullableNumericValue })}
                sourceRegistration={register("transportDistanceSource", { setValueAs: emptyToNullSource })}
                noteRegistration={register("distanceNote")}
                source={draftTransportDistanceSource}
                notePlaceholder="e.g., detour via the coastal road due to a bridge closure"
                errors={{
                  distanceKm: errors.transportDistanceKm?.message,
                  source: errors.transportDistanceSource?.message,
                  note: errors.distanceNote?.message,
                }}
                disabled={isSubmitting}
                certifyRequired={isFeedstockCertifyField("transportDistanceKm")}
                certifyStatus={transportDistanceCertStatus}
              />
            </ActionableFocusTarget>
          </div>
          {/* Origin mirrors the saved leg: the supplier's default location, else the supplier. */}
          <TransportRoutePreview
            entityType="feedstock"
            originName={defaultSupplierLocation?.name ?? selectedSupplier?.name}
            originPoint={supplierRoutePoint}
            destinationPoint={{ lat: watchedFacility?.gpsLatitude ?? null, lng: watchedFacility?.gpsLongitude ?? null }}
            destinationName={watchedFacility?.name}
            distanceKm={effectiveDistance.distanceKm}
            distanceSource={effectiveDistance.source}
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
              allowEdit
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
              rangeHelperText: INTAKE_MOISTURE_RANGE_HELPER,
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
