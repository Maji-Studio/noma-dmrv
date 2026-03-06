/**
 * FeedstockDeliveryForm component
 * Multi-section form for creating/editing feedstock deliveries
 * Includes delivery info, feedstock details, and documentation sections
 */
"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { numericValue } from "@/lib/form-utils";
import { deriveMassDryKg } from "@/lib/calculations/mass-dry";
import { formatLocalDate } from "@/lib/date-utils";
import { FormField, FormInput, FormTextarea, FormEntitySelect } from "@/components/forms";
import { Button } from "@/components/ui";
import {
  feedstockDeliveryFormSchema,
  type FeedstockDeliveryFormData,
} from "@/schemas/feedstock-deliveries";
import type { FeedstockDeliveryWithRelations } from "@/data-access/feedstock-deliveries";
import { DriverQuickAddDialog } from "@/components/forms/entity-select/driver-quick-add-dialog";
import { VehicleQuickAddDialog } from "@/components/forms/entity-select/vehicle-quick-add-dialog";
import { FeedstockTypeQuickAddDialog } from "@/components/forms/entity-select/feedstock-type-quick-add-dialog";
import { useQuickAddDialog } from "@/components/forms/entity-select";

const SET_VALUE_OPTS = { shouldDirty: true, shouldTouch: true, shouldValidate: true } as const;

// ============================================
// Component
// ============================================

interface FeedstockDeliveryFormProps {
  /** Existing delivery data for editing (undefined for create mode) */
  delivery?: FeedstockDeliveryWithRelations;
  /** Form submission handler */
  onSubmit: (data: FeedstockDeliveryFormData) => Promise<void> | void;
  /** Cancel button handler */
  onCancel?: () => void;
  /** Whether the form is currently submitting */
  isSubmitting?: boolean;
  /** Custom label for the submit button */
  submitLabel?: string;
}

export function FeedstockDeliveryForm({
  delivery,
  onSubmit,
  onCancel,
  isSubmitting = false,
  submitLabel,
}: FeedstockDeliveryFormProps) {
  const isEditMode = !!delivery;

  // Quick-add dialogs
  const driverDialog = useQuickAddDialog();
  const vehicleDialog = useQuickAddDialog();
  const feedstockTypeDialog = useQuickAddDialog();

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(feedstockDeliveryFormSchema),
    defaultValues: {
      facilityId: delivery?.facilityId ?? "",
      deliveryDate: delivery?.deliveryDate
        ? formatLocalDate(new Date(delivery.deliveryDate))
        : formatLocalDate(new Date()),
      supplierId: delivery?.supplierId ?? "",
      driverId: delivery?.driverId ?? "",
      vehicleId: delivery?.vehicleId ?? "",
      gpsLatitude: delivery?.gpsLatitude ?? null,
      gpsLongitude: delivery?.gpsLongitude ?? null,
      feedstockTypeId: delivery?.feedstockTypeId ?? "",
      weightKg: delivery?.weightKg ?? null,
      moisturePercent: delivery?.moisturePercent ?? null,
      notes: delivery?.notes ?? "",
    },
  });

  const watchWetMass = watch("weightKg");
  const watchMoisture = watch("moisturePercent");

  // Display-only dry mass preview (not stored — lives on the feedstock entity)
  const previewDryMass =
    typeof watchWetMass === "number" &&
    typeof watchMoisture === "number" &&
    watchWetMass >= 0 &&
    watchMoisture >= 0 &&
    watchMoisture <= 100
      ? deriveMassDryKg(watchWetMass, watchMoisture)
      : null;

  const defaultSubmitLabel = isEditMode ? "Update Delivery" : "Create Delivery";

  const handleFormSubmit = handleSubmit((data) => {
    onSubmit(data as FeedstockDeliveryFormData);
  });

  return (
    <>
      <form onSubmit={handleFormSubmit} className="space-y-20">
        {/* Delivery Information Section */}
        <div className="space-y-20">
          <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
            Delivery Information
          </h3>

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
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
            <FormEntitySelect
              control={control}
              name="facilityId"
              label="Facility"
              entityType="facility"
              placeholder="Select facility..."
              disabled={isSubmitting}
              required
            />

            <FormEntitySelect
              control={control}
              name="supplierId"
              label="Supplier"
              entityType="supplier"
              placeholder="Select supplier..."
              disabled={isSubmitting}
              required
            />
          </div>
        </div>

        {/* Transport Details Section */}
        <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
          <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
            Transport Details
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
            <FormEntitySelect
              control={control}
              name="driverId"
              label="Driver"
              entityType="driver"
              placeholder="Select driver..."
              disabled={isSubmitting}
              allowCreate
              alwaysShowSearch
              createLabel="Add new driver"
              onCreateNew={() => driverDialog.open()}
            />

            <FormEntitySelect
              control={control}
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
            <FormField
              id="gpsLatitude"
              label="GPS Latitude"
              error={errors.gpsLatitude?.message}
              helperText="-90 to 90"
            >
              <FormInput
                id="gpsLatitude"
                type="number"
                step="any"
                placeholder="e.g., -1.2921"
                disabled={isSubmitting}
                error={!!errors.gpsLatitude}
                {...register("gpsLatitude", { setValueAs: numericValue })}
              />
            </FormField>

            <FormField
              id="gpsLongitude"
              label="GPS Longitude"
              error={errors.gpsLongitude?.message}
              helperText="-180 to 180"
            >
              <FormInput
                id="gpsLongitude"
                type="number"
                step="any"
                placeholder="e.g., 36.8219"
                disabled={isSubmitting}
                error={!!errors.gpsLongitude}
                {...register("gpsLongitude", { setValueAs: numericValue })}
              />
            </FormField>
          </div>
        </div>

        {/* Feedstock Details Section */}
        <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
          <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
            Feedstock Details
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
            <FormEntitySelect
              control={control}
              name="feedstockTypeId"
              label="Feedstock Type"
              entityType="feedstockType"
              placeholder="Select feedstock type..."
              disabled={isSubmitting}
              allowCreate
              alwaysShowSearch
              createLabel="Add new feedstock type"
              onCreateNew={() => feedstockTypeDialog.open()}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
            <FormField
              id="weightKg"
              label="Weight / Wet Mass (kg)"
              error={errors.weightKg?.message}
              helperText="Total delivered weight including moisture"
            >
              <FormInput
                id="weightKg"
                type="number"
                step="0.01"
                min="0"
                placeholder="e.g., 1500"
                disabled={isSubmitting}
                error={!!errors.weightKg}
                {...register("weightKg", { setValueAs: numericValue })}
              />
            </FormField>

            <FormField
              id="moisturePercent"
              label="Moisture Content (%)"
              error={errors.moisturePercent?.message}
              helperText="0-100%"
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

          {/* Dry mass preview (display only — not stored on this entity) */}
          <div className="flex items-center gap-12 rounded-sm border border-[var(--color-border-tertiary)] bg-[var(--color-bg-tertiary)] px-16 py-12">
            <span className="body-small text-[var(--color-text-tertiary)]">Est. Dry Mass (kg)</span>
            <span className="body-medium font-medium text-[var(--color-text-primary)]">
              {previewDryMass !== null
                ? `${previewDryMass.toFixed(2)} kg`
                : "—"}
            </span>
            {previewDryMass !== null && (
              <span className="body-small text-[var(--color-text-quaternary)]">
                = {watchWetMass} × (1 − {watchMoisture}%)
              </span>
            )}
          </div>
        </div>

        {/* Documentation Section */}
        <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
          <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
            Documentation
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
            <div className="md:col-span-2">
              <FormField
                id="notes"
                label="Notes"
                error={errors.notes?.message}
                helperText="Additional delivery notes or documentation references"
              >
                <FormTextarea
                  id="notes"
                  placeholder="Enter any additional notes, weighbridge ticket references, bill of lading numbers, etc."
                  disabled={isSubmitting}
                  error={!!errors.notes}
                  rows={4}
                  {...register("notes")}
                />
              </FormField>
            </div>
          </div>
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

      {/* Quick-add dialogs */}
      <DriverQuickAddDialog
        isOpen={driverDialog.isOpen}
        onClose={driverDialog.close}
        onSuccess={(driver) => {
          setValue("driverId", driver.id, SET_VALUE_OPTS);
          driverDialog.close();
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
    </>
  );
}
