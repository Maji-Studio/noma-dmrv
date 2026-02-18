/**
 * FeedstockDeliveryForm component
 * Multi-section form for creating/editing feedstock deliveries
 * Includes delivery info, feedstock details, and documentation sections
 */
"use client";

import { useForm, type Control } from "react-hook-form";
import { FormField, FormInput, FormTextarea, FormEntitySelect } from "@/components/forms";
import { Button } from "@/components/ui";
import type { FeedstockDeliveryFormData } from "@/schemas/feedstock-deliveries";
import type { FeedstockDeliveryWithRelations } from "@/data-access/feedstock-deliveries";
import { DriverQuickAddDialog } from "@/components/forms/entity-select/driver-quick-add-dialog";
import { VehicleQuickAddDialog } from "@/components/forms/entity-select/vehicle-quick-add-dialog";
import { FeedstockTypeQuickAddDialog } from "@/components/forms/entity-select/feedstock-type-quick-add-dialog";
import { useQuickAddDialog } from "@/components/forms/entity-select";

// ============================================
// Internal Form Values Type (uses string for date inputs)
// ============================================

interface FormValues {
  code: string;
  facilityId: string;
  deliveryDate: string;
  supplierId: string;
  driverId: string;
  vehicleId: string;
  gpsLatitude: number | null;
  gpsLongitude: number | null;
  feedstockTypeId: string;
  weightKg: number | null;
  moisturePercent: number | null;
  notes: string;
}

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
  /** Pre-generated code for new deliveries */
  suggestedCode?: string;
}

export function FeedstockDeliveryForm({
  delivery,
  onSubmit,
  onCancel,
  isSubmitting = false,
  submitLabel,
  suggestedCode,
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
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: {
      code: delivery?.code ?? suggestedCode ?? "",
      facilityId: delivery?.facilityId ?? "",
      deliveryDate: delivery?.deliveryDate
        ? new Date(delivery.deliveryDate).toISOString().split("T")[0]
        : new Date().toISOString().split("T")[0],
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

  const defaultSubmitLabel = isEditMode ? "Update Delivery" : "Create Delivery";

  const handleFormSubmit = handleSubmit((data) => {
    // Transform form data to match the expected schema
    const formData: FeedstockDeliveryFormData = {
      code: data.code,
      facilityId: data.facilityId,
      deliveryDate: new Date(data.deliveryDate),
      supplierId: data.supplierId,
      driverId: data.driverId || null,
      vehicleId: data.vehicleId || null,
      gpsLatitude: data.gpsLatitude,
      gpsLongitude: data.gpsLongitude,
      feedstockTypeId: data.feedstockTypeId || null,
      weightKg: data.weightKg,
      moisturePercent: data.moisturePercent,
      notes: data.notes || "",
    };
    onSubmit(formData);
  });

  // Cast control for FormEntitySelect compatibility
  const formControl = control as unknown as Control<Record<string, unknown>>;

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
              id="code"
              label="Delivery Code"
              error={errors.code?.message}
            >
              <FormInput
                id="code"
                type="text"
                placeholder="Auto-generated if empty"
                disabled={isSubmitting}
                error={!!errors.code}
                {...register("code")}
              />
            </FormField>

            <FormField
              id="deliveryDate"
              label="Delivery Date"
              error={errors.deliveryDate?.message}
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
              control={formControl}
              name="facilityId"
              label="Facility"
              entityType="facility"
              placeholder="Select facility..."
              disabled={isSubmitting}
            />

            <FormEntitySelect
              control={formControl}
              name="supplierId"
              label="Supplier"
              entityType="supplier"
              placeholder="Select supplier..."
              disabled={isSubmitting}
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
              control={formControl}
              name="driverId"
              label="Driver (optional)"
              entityType="driver"
              placeholder="Select driver..."
              disabled={isSubmitting}
              allowCreate
              createLabel="Add new driver"
              onCreateNew={() => driverDialog.open()}
            />

            <FormEntitySelect
              control={formControl}
              name="vehicleId"
              label="Vehicle (optional)"
              entityType="vehicle"
              placeholder="Select vehicle..."
              disabled={isSubmitting}
              allowCreate
              createLabel="Add new vehicle"
              onCreateNew={() => vehicleDialog.open()}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
            <FormField
              id="gpsLatitude"
              label="GPS Latitude (optional)"
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
                {...register("gpsLatitude", { valueAsNumber: true })}
              />
            </FormField>

            <FormField
              id="gpsLongitude"
              label="GPS Longitude (optional)"
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
                {...register("gpsLongitude", { valueAsNumber: true })}
              />
            </FormField>
          </div>
        </div>

        {/* Feedstock Details Section */}
        <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
          <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
            Feedstock Details
          </h3>

          <FormEntitySelect
            control={formControl}
            name="feedstockTypeId"
            label="Feedstock Type (optional)"
            entityType="feedstockType"
            placeholder="Select feedstock type..."
            disabled={isSubmitting}
            allowCreate
            createLabel="Add new feedstock type"
            onCreateNew={() => feedstockTypeDialog.open()}
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
            <FormField
              id="weightKg"
              label="Weight (kg, optional)"
              error={errors.weightKg?.message}
              helperText="Total weight in kilograms"
            >
              <FormInput
                id="weightKg"
                type="number"
                step="0.01"
                min="0"
                placeholder="e.g., 1500"
                disabled={isSubmitting}
                error={!!errors.weightKg}
                {...register("weightKg", { valueAsNumber: true })}
              />
            </FormField>

            <FormField
              id="moisturePercent"
              label="Moisture Content (%, optional)"
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
                {...register("moisturePercent", { valueAsNumber: true })}
              />
            </FormField>
          </div>
        </div>

        {/* Documentation Section */}
        <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
          <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
            Documentation
          </h3>

          <FormField
            id="notes"
            label="Notes (optional)"
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
          setValue("driverId", driver.id);
          driverDialog.close();
        }}
      />

      <VehicleQuickAddDialog
        isOpen={vehicleDialog.isOpen}
        onClose={vehicleDialog.close}
        onSuccess={(vehicle) => {
          setValue("vehicleId", vehicle.id);
          vehicleDialog.close();
        }}
      />

      <FeedstockTypeQuickAddDialog
        isOpen={feedstockTypeDialog.isOpen}
        onClose={feedstockTypeDialog.close}
        onSuccess={(feedstockType) => {
          setValue("feedstockTypeId", feedstockType.id);
          feedstockTypeDialog.close();
        }}
      />
    </>
  );
}
