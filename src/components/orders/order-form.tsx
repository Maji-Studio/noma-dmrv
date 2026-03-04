/**
 * OrderForm component
 * Reusable order form with React Hook Form integration
 */
"use client";

import { numericValue } from "@/lib/form-utils";
import { formatLocalDate } from "@/lib/date-utils";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormField, FormInput } from "@/components/forms";
import { FormSelect } from "@/components/forms/form-select";
import { Button } from "@/components/ui";
import {
  orderFormSchema,
  packagingTypes,
  type OrderFormData,
  type PackagingType,
} from "@/schemas/orders";
import type { Order } from "@/db/schema";
import { useFacilities } from "@/hooks/use-facilities";
import { useCustomers, useCustomerLocations } from "@/hooks/use-customers";
import { useBiocharProducts } from "@/hooks/use-biochar-products";
import { useState, useEffect } from "react";

// ============================================
// Constants for select options
// ============================================

const packagingOptions: readonly { value: string; label: string }[] =
  packagingTypes.map((type) => ({
    value: type,
    label: formatPackaging(type),
  }));

// ============================================
// Formatting helpers
// ============================================

function formatPackaging(type: PackagingType): string {
  const labels: Record<PackagingType, string> = {
    loose: "Loose",
    bagged: "Bagged",
  };
  return labels[type];
}

// ============================================
// Component
// ============================================

interface OrderFormProps {
  /** Existing order data for editing (undefined for create mode) */
  order?: Order;
  /** Form submission handler */
  onSubmit: (data: OrderFormData) => Promise<void> | void;
  /** Cancel button handler */
  onCancel?: () => void;
  /** Whether the form is currently submitting */
  isSubmitting?: boolean;
  /** Custom label for the submit button */
  submitLabel?: string;
}

export function OrderForm({
  order,
  onSubmit,
  onCancel,
  isSubmitting = false,
  submitLabel,
}: OrderFormProps) {
  const isEditMode = !!order;
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | undefined>(
    order?.customerId ?? undefined
  );

  // Fetch related data for dropdowns
  const { data: facilitiesData } = useFacilities({ pageSize: 100 });
  const { data: customersData } = useCustomers({ pageSize: 100 });
  const { data: productsData } = useBiocharProducts({ pageSize: 100 });
  const { data: customerLocationsData } = useCustomerLocations(
    selectedCustomerId ?? "",
    !!selectedCustomerId
  );

  const facilities = facilitiesData?.items ?? [];
  const customers = customersData?.items ?? [];
  const products = productsData?.items ?? [];

  // Get customer locations for selected customer
  const customerLocations = customerLocationsData ?? [];

  const facilityOptions = facilities.map((f) => ({
    value: f.id,
    label: f.name,
  }));

  const customerOptions = customers.map((c) => ({
    value: c.id,
    label: c.name,
  }));

  const locationOptions = customerLocations.map((l: { id: string; name: string }) => ({
    value: l.id,
    label: l.name,
  }));

  const productOptions = products.map((p) => ({
    value: p.id,
    label: [p.formulation?.name, p.facility?.name].filter(Boolean).join(" - ") || "Biochar product",
  }));

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(orderFormSchema),
    defaultValues: {
      facilityId: order?.facilityId ?? "",
      customerId: order?.customerId ?? "",
      customerLocationId: order?.customerLocationId ?? "",
      biocharProductId: order?.biocharProductId ?? "",
      orderDate: order?.orderDate
        ? formatLocalDate(new Date(order.orderDate))
        : formatLocalDate(new Date()),
      quantityKg: order?.quantityKg ?? undefined,
      packaging: (order?.packaging as PackagingType) ?? "loose",
      value: order?.value ?? undefined,
      currency: order?.currency ?? "TZS",
    },
  });

  const watchedCustomerId = watch("customerId");

  // Update customer locations when customer changes
  useEffect(() => {
    if (watchedCustomerId !== selectedCustomerId) {
      setSelectedCustomerId(watchedCustomerId || undefined);
      // Clear customer location when customer changes
      if (watchedCustomerId !== order?.customerId) {
        setValue("customerLocationId", "");
      }
    }
  }, [watchedCustomerId, selectedCustomerId, order?.customerId, setValue]);

  // Auto-select location when customer has exactly one
  useEffect(() => {
    if (customerLocations.length === 1 && !watch("customerLocationId")) {
      setValue("customerLocationId", customerLocations[0].id);
    }
  }, [customerLocations, setValue, watch]);

  const defaultSubmitLabel = isEditMode ? "Update Order" : "Create Order";

  const handleFormSubmit = handleSubmit((data) => {
    onSubmit(data as OrderFormData);
  });

  return (
    <form onSubmit={handleFormSubmit} className="space-y-20">
      {/* Required Fields Section */}
      <div className="space-y-20">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Order Information
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="orderDate"
            label="Order Date"
            error={errors.orderDate?.message}
            required
          >
            <FormInput
              id="orderDate"
              type="date"
              disabled={isSubmitting}
              error={!!errors.orderDate}
              {...register("orderDate")}
            />
          </FormField>

          <FormField
            id="facilityId"
            label="Facility"
            error={errors.facilityId?.message}
            required
          >
            <FormSelect
              id="facilityId"
              placeholder="Select facility..."
              disabled={isSubmitting}
              error={!!errors.facilityId}
              options={facilityOptions}
              {...register("facilityId")}
            />
          </FormField>
        </div>
      </div>

      {/* Customer Section */}
      <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Customer Details
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="customerId"
            label="Customer"
            error={errors.customerId?.message}
            required
          >
            <FormSelect
              id="customerId"
              placeholder="Select customer..."
              disabled={isSubmitting}
              error={!!errors.customerId}
              options={customerOptions}
              {...register("customerId")}
            />
          </FormField>

          <FormField
            id="customerLocationId"
            label="Delivery Location"
            error={errors.customerLocationId?.message}
            required
          >
            <FormSelect
              id="customerLocationId"
              placeholder={
                selectedCustomerId
                  ? "Select location..."
                  : "Select a customer first"
              }
              disabled={isSubmitting || !selectedCustomerId}
              error={!!errors.customerLocationId}
              options={locationOptions}
              {...register("customerLocationId")}
            />
          </FormField>
        </div>
      </div>

      {/* Product Section */}
      <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Product Details
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="biocharProductId"
            label="Biochar Product"
            error={errors.biocharProductId?.message}
            required
          >
            <FormSelect
              id="biocharProductId"
              placeholder="Select product..."
              disabled={isSubmitting}
              error={!!errors.biocharProductId}
              options={productOptions}
              {...register("biocharProductId")}
            />
          </FormField>

          <FormField
            id="packaging"
            label="Packaging"
            error={errors.packaging?.message}
            required
          >
            <FormSelect
              id="packaging"
              disabled={isSubmitting}
              error={!!errors.packaging}
              options={packagingOptions}
              {...register("packaging")}
            />
          </FormField>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-16 gap-y-20">
          <FormField
            id="quantityKg"
            label="Quantity (kg)"
            error={errors.quantityKg?.message}
            required
          >
            <FormInput
              id="quantityKg"
              type="number"
              step="0.01"
              placeholder="e.g., 1000"
              disabled={isSubmitting}
              error={!!errors.quantityKg}
              {...register("quantityKg", {
                setValueAs: numericValue,
              })}
            />
          </FormField>

          <FormField
            id="value"
            label="Value"
            error={errors.value?.message}
          >
            <FormInput
              id="value"
              type="number"
              step="0.01"
              placeholder="e.g., 50000"
              disabled={isSubmitting}
              error={!!errors.value}
              {...register("value", {
                setValueAs: numericValue,
              })}
            />
          </FormField>

          <FormField
            id="currency"
            label="Currency"
            error={errors.currency?.message}
          >
            <FormInput
              id="currency"
              type="text"
              placeholder="e.g., TZS"
              disabled={isSubmitting}
              error={!!errors.currency}
              {...register("currency")}
            />
          </FormField>
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
