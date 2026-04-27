/**
 * FeedstockForm component
 * Unified form combining delivery info + material + bin allocations.
 * Supports split deliveries (one truck → multiple bins) and
 * shows a dry mass warning when allocated > delivered.
 */
"use client";

import { useEffect, useState } from "react";
import { useForm, useWatch, useFieldArray, type FieldError } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "@phosphor-icons/react";
import { numericValue } from "@/lib/form-utils";
import { deriveMassDryKg } from "@/lib/calculations/mass-dry";
import { toDateInputValue } from "@/lib/date-utils";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { useEntityById } from "@/hooks/use-entities";
import { FormField, FormInput, FormTextarea, FormEntitySelect, SectionLabel, ServerError } from "@/components/forms";
import { FormActions } from "@/components/forms/form-actions";
import { Button } from "@/components/ui";
import {
  feedstockFormSchema,
  type FeedstockFormData,
} from "@/schemas/feedstocks";
import type { FeedstockWithRelations } from "@/data-access/feedstocks";
import { VehicleQuickAddDialog } from "@/components/forms/entity-select/vehicle-quick-add-dialog";
import { FeedstockTypeQuickAddDialog } from "@/components/forms/entity-select/feedstock-type-quick-add-dialog";
import { StorageLocationQuickAddDialog } from "@/components/forms/entity-select/storage-location-quick-add-dialog";
import { useQuickAddDialog } from "@/components/forms/entity-select";
import { BinAllocationRow } from "./bin-allocation-row";
import { WetMassWarning } from "./wet-mass-warning";

const SET_VALUE_OPTS = { shouldDirty: true, shouldTouch: true, shouldValidate: true } as const;

const FEEDSTOCK_ALLOCATION_BIN_TYPE_FILTER = "feedstock_bin,ingredient_bin";

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
}

export function FeedstockForm({
  feedstock,
  onSubmit,
  onCancel,
  isSubmitting = false,
  submitLabel,
  serverError,
}: FeedstockFormProps) {
  const isEditMode = !!feedstock;
  const { facilityId: contextFacilityId } = useFacilityContext();

  // Quick-add dialogs
  const vehicleDialog = useQuickAddDialog();
  const feedstockTypeDialog = useQuickAddDialog();
  const storageLocationDialog = useQuickAddDialog();
  const [storageLocationRowIndex, setStorageLocationRowIndex] = useState<number>(0);

  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(feedstockFormSchema),
    defaultValues: {
      facilityId: feedstock?.facilityId ?? contextFacilityId ?? "",
      deliveryDate: toDateInputValue(feedstock?.deliveryDate ?? null),
      supplierId: feedstock?.supplierId ?? "",
      vehicleId: feedstock?.vehicleId ?? "",
      feedstockTypeId: feedstock?.feedstockTypeId ?? "",
      totalWetMassKg: feedstock?.massWetKg ?? ("" as unknown as number),
      moisturePercent: feedstock?.moistureContentPercent ?? ("" as unknown as number),
      allocations: feedstock
        ? [{ storageLocationId: feedstock.storageLocationId ?? "", allocatedWetMassKg: feedstock.massWetKg ?? 0 }]
        : [{ storageLocationId: "", allocatedWetMassKg: "" as unknown as number }],
      overrideJustification: feedstock?.overrideJustification ?? "",
      notes: feedstock?.notes ?? "",
    },
  });

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

  // Default new bins by feedstock category, while allowing intake into either compatible bin type.
  const { data: selectedFeedstockType } = useEntityById("feedstockType", watchedFeedstockTypeId || undefined);
  const defaultStorageBinType = selectedFeedstockType?.subtitle === "ingredient"
    ? "ingredient_bin"
    : "feedstock_bin";

  // Auto-set facility from context
  useEffect(() => {
    if (!feedstock && contextFacilityId && !watchedFacilityId) {
      setValue("facilityId", contextFacilityId);
    }
  }, [feedstock, contextFacilityId, watchedFacilityId, setValue]);

  // Calculated dry mass
  const deliveredDryMassKg =
    typeof watchWetMass === "number" &&
    typeof watchMoisture === "number" &&
    watchWetMass >= 0 &&
    watchMoisture >= 0 &&
    watchMoisture <= 100
      ? deriveMassDryKg(watchWetMass, watchMoisture)
      : null;

  // Sum of allocated wet mass
  const allocatedTotalWetKg = (watchAllocations ?? []).reduce((sum, a) => {
    const val = typeof a.allocatedWetMassKg === "number" ? a.allocatedWetMassKg : 0;
    return sum + val;
  }, 0);

  const showOverageWarning =
    typeof watchWetMass === "number" && allocatedTotalWetKg > watchWetMass;

  const defaultSubmitLabel = isEditMode ? "Update Feedstock" : "Create Feedstock";

  const handleFormSubmit = handleSubmit((data) => {
    onSubmit(data as FeedstockFormData);
  });

  return (
    <>
      <form onSubmit={handleFormSubmit} className="space-y-20">
        {/* Delivery Information */}
        <div className="space-y-20">
          <SectionLabel>
            Delivery Information
          </SectionLabel>

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
              label="Delivery Date"
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
            />
          </div>
        </div>

        {/* Transport Details */}
        <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
          <SectionLabel>
            Transport Details
          </SectionLabel>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
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
        </div>

        {/* Material Details */}
        <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
          <SectionLabel>
            Material
          </SectionLabel>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
            <FormEntitySelect
              control={formControl}
              name="feedstockTypeId"
              label="Feedstock Type"
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
            <FormField
              id="totalWetMassKg"
              label="Total Wet Mass (kg)"
              error={errors.totalWetMassKg?.message}
              helperText="As-received weight of the entire delivery"
              required
            >
              <FormInput
                id="totalWetMassKg"
                type="number"
                step="0.01"
                min="0"
                placeholder="e.g., 1500"
                disabled={isSubmitting}
                error={!!errors.totalWetMassKg}
                {...register("totalWetMassKg", { setValueAs: numericValue })}
              />
            </FormField>

            <FormField
              id="moisturePercent"
              label="Moisture Content (%)"
              error={errors.moisturePercent?.message}
              helperText="0-100%"
              required
            >
              <FormInput
                id="moisturePercent"
                type="number"
                step="0.1"
                min="0"
                max="100"
                placeholder="e.g., 35"
                disabled={isSubmitting}
                error={!!errors.moisturePercent}
                {...register("moisturePercent", { setValueAs: numericValue })}
              />
            </FormField>
          </div>

          {/* Dry mass preview */}
          <div className="flex items-center gap-12 border border-[var(--color-border-tertiary)] bg-[var(--color-bg-tertiary)] px-16 py-12">
            <span className="body-small text-[var(--color-text-tertiary)]">Delivered Dry Mass (kg)</span>
            <span className="body-medium font-medium text-[var(--color-text-primary)]">
              {deliveredDryMassKg !== null ? `${deliveredDryMassKg.toFixed(2)} kg` : "\u2014"}
            </span>
            {deliveredDryMassKg !== null && (
              <span className="body-small text-[var(--color-text-quaternary)]">
                = {Number(watchWetMass ?? 0).toFixed(2)} &times; (1 &minus; {Number(watchMoisture ?? 0).toFixed(2)}%)
              </span>
            )}
          </div>
        </div>

        {/* Bin Allocations — only shown after feedstock type is selected and loaded */}
        {watchedFeedstockTypeId && selectedFeedstockType ? (
          <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
            <div className="flex items-center justify-between">
              <SectionLabel>
                Bin Allocations
              </SectionLabel>
              {!isEditMode && (
                <Button
                  type="button"
                  variant="default"
                  size="small"
                  onClick={() => append({ storageLocationId: "", allocatedWetMassKg: "" as unknown as number })}
                  disabled={isSubmitting}
                >
                  <Plus size={16} weight="bold" />
                  Add Bin
                </Button>
              )}
            </div>

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
              <div className="flex items-center gap-12 border border-[var(--color-border-tertiary)] bg-[var(--color-bg-tertiary)] px-16 py-12">
                <span className="body-small text-[var(--color-text-tertiary)]">Total Allocated</span>
                <span className="body-medium font-medium text-[var(--color-text-primary)]">
                  {allocatedTotalWetKg.toFixed(2)} kg
                </span>
                {typeof watchWetMass === "number" && (
                  <span className="body-small text-[var(--color-text-quaternary)]">
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
          </div>
        ) : null}

        {/* Documentation */}
        <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
          <SectionLabel>
            Documentation
          </SectionLabel>

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
        </div>

        {/* Server Error */}
        {serverError && <ServerError message={serverError} />}

        <FormActions
          onCancel={onCancel}
          isSubmitting={isSubmitting}
          submitLabel={submitLabel}
          defaultSubmitLabel={defaultSubmitLabel}
        />
      </form>

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
          facilityId={watchedFacilityId}
        />
      )}
    </>
  );
}
