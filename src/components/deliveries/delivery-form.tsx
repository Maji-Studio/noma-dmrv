/**
 * DeliveryForm component
 * Reusable delivery form with React Hook Form integration
 * Includes validation: massDryKg <= deliveredWetMassKg
 */
"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormField, FormInput } from "@/components/forms";
import { FormSelect } from "@/components/forms/form-select";
import { Button } from "@/components/ui";
import {
  deliveryFormSchema,
  deliveryStatuses,
  type DeliveryFormData,
  type DeliveryStatus,
} from "@/schemas/deliveries";
import type { Delivery } from "@/db/schema";
import { useOrdersForSelect } from "@/hooks/use-orders";

// ============================================
// Constants for select options
// ============================================

const statusOptions: readonly { value: string; label: string }[] =
  deliveryStatuses.map((status) => ({
    value: status,
    label: formatStatus(status),
  }));

// ============================================
// Formatting helpers
// ============================================

function formatStatus(status: DeliveryStatus): string {
  const labels: Record<DeliveryStatus, string> = {
    scheduled: "Scheduled",
    processing: "Processing",
    delivered: "Delivered",
  };
  return labels[status];
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

export function DeliveryForm({
  delivery,
  onSubmit,
  onCancel,
  isSubmitting = false,
  submitLabel,
}: DeliveryFormProps) {
  const isEditMode = !!delivery;

  // Fetch orders for dropdown
  const { data: ordersData } = useOrdersForSelect();
  const orders = ordersData ?? [];

  const orderOptions = orders.map((o) => ({
    value: o.id,
    label: `${o.code}${o.customerName ? ` - ${o.customerName}` : ""}`,
  }));

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(deliveryFormSchema),
    defaultValues: {
      code: delivery?.code ?? "",
      orderId: delivery?.orderId ?? "",
      deliveryDate: delivery?.deliveryDate
        ? new Date(delivery.deliveryDate).toISOString().split("T")[0]
        : new Date().toISOString().split("T")[0],
      status: (delivery?.status as DeliveryStatus) ?? "processing",
      deliveredWetMassKg: delivery?.deliveredWetMassKg ?? undefined,
      massDryKg: delivery?.massDryKg ?? undefined,
      moistureContentPercent: delivery?.moistureContentPercent ?? undefined,
      biocharProductId: delivery?.biocharProductId ?? undefined,
      driverId: delivery?.driverId ?? undefined,
      vehicleId: delivery?.vehicleId ?? undefined,
    },
  });

  const deliveredWetMassKg = watch("deliveredWetMassKg");

  const defaultSubmitLabel = isEditMode ? "Update Delivery" : "Create Delivery";

  const handleFormSubmit = handleSubmit((data) => {
    onSubmit(data as DeliveryFormData);
  });

  return (
    <form onSubmit={handleFormSubmit} className="space-y-20">
      {/* Delivery Information Section */}
      <div className="space-y-20">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Delivery Information
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField id="code" label="Delivery Code" error={errors.code?.message}>
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
      </div>

      {/* Mass Measurements Section */}
      <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Mass Measurements
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-16 gap-y-20">
          <FormField
            id="deliveredWetMassKg"
            label="Wet Mass (kg)"
            error={errors.deliveredWetMassKg?.message}
            helperText="Total delivered weight including moisture"
          >
            <FormInput
              id="deliveredWetMassKg"
              type="number"
              step="0.01"
              placeholder="e.g., 1000"
              disabled={isSubmitting}
              error={!!errors.deliveredWetMassKg}
              {...register("deliveredWetMassKg", {
                setValueAs: (v) =>
                  v === "" || v === null || v === undefined
                    ? undefined
                    : parseFloat(v),
              })}
            />
          </FormField>

          <FormField
            id="massDryKg"
            label="Dry Mass (kg)"
            error={errors.massDryKg?.message}
            helperText={
              deliveredWetMassKg
                ? `Must be ≤ ${deliveredWetMassKg} kg`
                : "Must be less than or equal to wet mass"
            }
          >
            <FormInput
              id="massDryKg"
              type="number"
              step="0.01"
              placeholder="e.g., 800"
              disabled={isSubmitting}
              error={!!errors.massDryKg}
              {...register("massDryKg", {
                setValueAs: (v) =>
                  v === "" || v === null || v === undefined
                    ? undefined
                    : parseFloat(v),
              })}
            />
          </FormField>

          <FormField
            id="moistureContentPercent"
            label="Moisture Content (%)"
            error={errors.moistureContentPercent?.message}
            helperText="Value between 0 and 100"
          >
            <FormInput
              id="moistureContentPercent"
              type="number"
              step="0.1"
              placeholder="e.g., 20"
              disabled={isSubmitting}
              error={!!errors.moistureContentPercent}
              {...register("moistureContentPercent", {
                setValueAs: (v) =>
                  v === "" || v === null || v === undefined
                    ? undefined
                    : parseFloat(v),
              })}
            />
          </FormField>
        </div>

        {/* Validation hint */}
        <div className="p-24 bg-[var(--color-background-medium)] border border-[var(--color-border-tertiary)]">
          <p className="body-small text-[var(--color-text-secondary)]">
            <strong>Note:</strong> Dry mass must always be less than or equal to
            wet mass. This is validated automatically.
          </p>
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
  );
}
