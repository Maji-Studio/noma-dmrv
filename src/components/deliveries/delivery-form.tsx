/**
 * DeliveryForm component
 * Reusable delivery form with React Hook Form integration
 * Includes validation: massDryKg <= deliveredWetMassKg
 */
"use client";

import { useEffect } from "react";
import { numericValue } from "@/lib/form-utils";
import { formatLocalDate } from "@/lib/date-utils";
import { deriveMassDryKg } from "@/lib/calculations/mass-dry";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormField, FormInput } from "@/components/forms";
import { FormSelect } from "@/components/forms/form-select";
import { Button } from "@/components/ui";
import { deliveryFormSchema, deliveryStatuses, type DeliveryFormData, type DeliveryStatus } from "@/schemas/deliveries";
import type { Delivery } from "@/db/schema";
import { useOrdersForSelect } from "@/hooks/use-orders";
import { useFacilityContext } from "@/hooks/use-facility-context";

// ============================================
// Constants for select options
// ============================================

const statusOptions: readonly { value: string; label: string }[] = deliveryStatuses.map((status) => ({
  value: status,
  label: formatStatus(status),
}));

// ============================================
// Formatting helpers
// ============================================

function formatStatus(status: DeliveryStatus): string {
  const labels: Record<DeliveryStatus, string> = {
    upcoming: "Upcoming",
    delivered: "Delivered",
  };
  return labels[status];
}

function isDeliveryStatus(value: string | null | undefined): value is DeliveryStatus {
  return !!value && deliveryStatuses.includes(value as DeliveryStatus);
}

// ============================================
// Component
// ============================================

interface DeliveryFormProps {
  /** Existing delivery data for editing (undefined for create mode) */
  delivery?: Delivery;
  /** Form submission handler */
  onSubmit: (data: DeliveryFormData) => Promise<void> | void;
  /** Cancel button handler */
  onCancel?: () => void;
  /** Whether the form is currently submitting */
  isSubmitting?: boolean;
  /** Custom label for the submit button */
  submitLabel?: string;
}

export function DeliveryForm({ delivery, onSubmit, onCancel, isSubmitting = false, submitLabel }: DeliveryFormProps) {
  const isEditMode = !!delivery;
  const { facilityId: contextFacilityId } = useFacilityContext();

  // Fetch orders for dropdown
  const { data: ordersData } = useOrdersForSelect(contextFacilityId ?? undefined, {
    enabled: !!contextFacilityId,
  });
  const orders = ordersData ?? [];
  const defaultStatus: DeliveryStatus = isDeliveryStatus(delivery?.status) ? delivery.status : "upcoming";

  const orderOptions = orders.map((o) => ({
    value: o.id,
    label:
      [
        o.customerName,
        o.biocharProductCode,
        o.quantityKg ? `${o.quantityKg} kg` : undefined,
        o.orderDate ? new Date(o.orderDate).toLocaleDateString() : undefined,
      ]
        .filter(Boolean)
        .join(" — ") || "Order",
  }));

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(deliveryFormSchema),
    defaultValues: {
      orderId: delivery?.orderId ?? "",
      deliveryDate: delivery?.deliveryDate ?? formatLocalDate(new Date()),
      status: defaultStatus,
      deliveredWetMassKg: delivery?.deliveredWetMassKg ?? undefined,
      massDryKg: delivery?.massDryKg ?? undefined,
      moistureContentPercent: delivery?.moistureContentPercent ?? undefined,
      truckMassOnArrivalKg: delivery?.truckMassOnArrivalKg ?? undefined,
      truckMassOnDepartureKg: delivery?.truckMassOnDepartureKg ?? undefined,
      biocharProductId: delivery?.biocharProductId ?? undefined,
      driverId: delivery?.driverId ?? undefined,
      vehicleId: delivery?.vehicleId ?? undefined,
      transportDistanceKm: undefined,
    },
  });

  const watchWetMass = watch("deliveredWetMassKg");
  const watchMoisture = watch("moistureContentPercent");

  // Auto-calculate dry mass from wet mass and moisture using shared utility
  const calculatedDryMass =
    typeof watchWetMass === "number" &&
    typeof watchMoisture === "number" &&
    watchWetMass >= 0 &&
    watchMoisture >= 0 &&
    watchMoisture <= 100
      ? deriveMassDryKg(watchWetMass, watchMoisture)
      : null;

  // Sync calculated dry mass into the form (clear when inputs become invalid)
  useEffect(() => {
    if (calculatedDryMass !== null) {
      setValue("massDryKg", calculatedDryMass);
    } else {
      setValue("massDryKg", undefined as unknown as number);
    }
  }, [calculatedDryMass, setValue]);

  const defaultSubmitLabel = isEditMode ? "Update Delivery" : "Create Delivery";

  const handleFormSubmit = handleSubmit((data) => {
    return onSubmit(data as DeliveryFormData);
  });

  return (
    <form onSubmit={handleFormSubmit} className="space-y-20">
      {/* Delivery Information Section */}
      <div className="space-y-20">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Delivery Information
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField id="deliveryDate" label="Delivery Date" error={errors.deliveryDate?.message}>
            <FormInput
              id="deliveryDate"
              type="date"
              disabled={isSubmitting}
              error={!!errors.deliveryDate}
              {...register("deliveryDate")}
            />
          </FormField>

          <FormField id="status" label="Status" error={errors.status?.message}>
            <FormSelect
              id="status"
              disabled={isSubmitting}
              error={!!errors.status}
              options={statusOptions}
              {...register("status")}
            />
          </FormField>
        </div>

        <FormField id="orderId" label="Order" error={errors.orderId?.message}>
          <FormSelect
            id="orderId"
            placeholder="Select order..."
            disabled={isSubmitting}
            error={!!errors.orderId}
            options={orderOptions}
            {...register("orderId")}
          />
        </FormField>
      </div>

      {/* Mass & Moisture Section */}
      <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Mass & Moisture
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="deliveredWetMassKg"
            label="Wet Mass (kg)"
            error={errors.deliveredWetMassKg?.message}
            helperText="As-received weight"
            required
          >
            <FormInput
              id="deliveredWetMassKg"
              type="number"
              step="0.01"
              placeholder="e.g., 1000"
              disabled={isSubmitting}
              error={!!errors.deliveredWetMassKg}
              {...register("deliveredWetMassKg", {
                setValueAs: numericValue,
              })}
            />
          </FormField>

          <FormField
            id="moistureContentPercent"
            label="Moisture (%)"
            error={errors.moistureContentPercent?.message}
            helperText="0–100%"
            required
          >
            <FormInput
              id="moistureContentPercent"
              type="number"
              step="0.1"
              min="0"
              max="100"
              placeholder="e.g., 20"
              disabled={isSubmitting}
              error={!!errors.moistureContentPercent}
              {...register("moistureContentPercent", {
                setValueAs: numericValue,
              })}
            />
          </FormField>
        </div>

        {/* Dry mass preview (display only — auto-calculated) */}
        <div className="flex items-center gap-12 rounded-sm border border-[var(--color-border-tertiary)] bg-[var(--color-bg-tertiary)] px-16 py-12">
          <span className="body-small text-[var(--color-text-tertiary)]">Dry Mass (kg)</span>
          <span className="body-medium font-medium text-[var(--color-text-primary)]">
            {calculatedDryMass !== null ? `${calculatedDryMass.toFixed(2)} kg` : "—"}
          </span>
          {calculatedDryMass !== null && (
            <span className="body-small text-[var(--color-text-quaternary)]">
              = {Number(watchWetMass ?? 0).toFixed(0)} × (1 − {Number(watchMoisture ?? 0)}%)
            </span>
          )}
        </div>
        {errors.massDryKg?.message && (
          <p className="body-small text-[var(--color-status-error)]">{errors.massDryKg.message}</p>
        )}
        <input type="hidden" {...register("massDryKg", { setValueAs: numericValue })} />
      </div>

      {/* Truck Weighing Section */}
      <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Truck Weighing at Delivery Site
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="truckMassOnArrivalKg"
            label="Truck Mass Before Unloading (kg)"
            error={errors.truckMassOnArrivalKg?.message}
          >
            <FormInput
              id="truckMassOnArrivalKg"
              type="number"
              step="any"
              placeholder="e.g., 15000"
              disabled={isSubmitting}
              error={!!errors.truckMassOnArrivalKg}
              {...register("truckMassOnArrivalKg", {
                setValueAs: numericValue,
              })}
            />
          </FormField>

          <FormField
            id="truckMassOnDepartureKg"
            label="Truck Mass After Unloading (kg)"
            error={errors.truckMassOnDepartureKg?.message}
          >
            <FormInput
              id="truckMassOnDepartureKg"
              type="number"
              step="any"
              placeholder="e.g., 5000"
              disabled={isSubmitting}
              error={!!errors.truckMassOnDepartureKg}
              {...register("truckMassOnDepartureKg", {
                setValueAs: numericValue,
              })}
            />
          </FormField>
        </div>
      </div>

      {/* Transport */}
      <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Transport
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="transportDistanceKm"
            label="Transport distance (km)"
            error={errors.transportDistanceKm?.message}
            helperText="Leave blank to use the customer location's stored distance from facility. Override here if the route differs."
          >
            <FormInput
              id="transportDistanceKm"
              type="number"
              step="0.1"
              min="0"
              placeholder="e.g., 120"
              disabled={isSubmitting}
              error={!!errors.transportDistanceKm}
              {...register("transportDistanceKm", { setValueAs: numericValue })}
            />
          </FormField>
        </div>
        <p className="body-small text-[var(--color-text-tertiary)]">
          We record distance + delivered mass as one road transport leg.
          Isometric applies the emission factor.
        </p>
      </div>

      {/* Form Actions */}
      <div className="flex items-center justify-end gap-16 pt-20 border-t border-[var(--color-border-secondary)]">
        {onCancel && (
          <Button type="button" variant="default" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </Button>
        )}
        <Button type="submit" variant="primary" disabled={isSubmitting}>
          {isSubmitting ? "Saving..." : (submitLabel ?? defaultSubmitLabel)}
        </Button>
      </div>
    </form>
  );
}
