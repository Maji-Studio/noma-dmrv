/**
 * SupplierForm component
 * Reusable supplier form with React Hook Form integration
 * Used in both create and edit views for suppliers
 */
"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormField, FormInput, FormTextarea } from "@/components/forms";
import { Button } from "@/components/ui";
import {
  supplierFormSchema,
  type SupplierFormData,
} from "@/schemas/suppliers";
import type { Supplier } from "@/db/schema/parties";

// ============================================
// Component
// ============================================

interface SupplierFormProps {
  /** Existing supplier data for editing (undefined for create mode) */
  supplier?: Supplier;
  /** Form submission handler */
  onSubmit: (data: SupplierFormData) => Promise<void> | void;
  /** Cancel button handler */
  onCancel?: () => void;
  /** Whether the form is currently submitting */
  isSubmitting?: boolean;
  /** Custom label for the submit button */
  submitLabel?: string;
}

export function SupplierForm({
  supplier,
  onSubmit,
  onCancel,
  isSubmitting = false,
  submitLabel,
}: SupplierFormProps) {
  const isEditMode = !!supplier;

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(supplierFormSchema),
    defaultValues: {
      code: supplier?.code ?? "",
      name: supplier?.name ?? "",
      location: supplier?.location ?? "",
      gpsLatitude: supplier?.gpsLatitude ?? null,
      gpsLongitude: supplier?.gpsLongitude ?? null,
      address: supplier?.address ?? "",
      contactName: supplier?.contactName ?? "",
      contactEmail: supplier?.contactEmail ?? "",
      contactPhone: supplier?.contactPhone ?? "",
      annualRevenueUsd: supplier?.annualRevenueUsd ?? null,
      chainOfCustodyRef: supplier?.chainOfCustodyRef ?? "",
    },
  });

  const defaultSubmitLabel = isEditMode ? "Update Supplier" : "Create Supplier";

  const handleFormSubmit = handleSubmit((data) => {
    onSubmit(data as SupplierFormData);
  });

  return (
    <form onSubmit={handleFormSubmit} className="space-y-20">
      {/* Required Fields Section */}
      <div className="space-y-20">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Required Information
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="code"
            label="Supplier Code"
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
            id="name"
            label="Supplier Name"
            error={errors.name?.message}
          >
            <FormInput
              id="name"
              type="text"
              placeholder="e.g., Green Biomass Co."
              disabled={isSubmitting}
              error={!!errors.name}
              {...register("name")}
            />
          </FormField>
        </div>
      </div>

      {/* Location Information Section */}
      <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Location Information
        </h3>

        <FormField
          id="location"
          label="Location (optional)"
          error={errors.location?.message}
          helperText="General location or region of the supplier"
        >
          <FormInput
            id="location"
            type="text"
            placeholder="e.g., Nairobi, Kenya"
            disabled={isSubmitting}
            error={!!errors.location}
            {...register("location")}
          />
        </FormField>

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

        <FormField
          id="address"
          label="Address (optional)"
          error={errors.address?.message}
        >
          <FormTextarea
            id="address"
            placeholder="Full address"
            disabled={isSubmitting}
            error={!!errors.address}
            {...register("address")}
          />
        </FormField>
      </div>

      {/* Contact Information Section */}
      <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Contact Information
        </h3>

        <FormField
          id="contactName"
          label="Contact Name (optional)"
          error={errors.contactName?.message}
        >
          <FormInput
            id="contactName"
            type="text"
            placeholder="e.g., John Doe"
            disabled={isSubmitting}
            error={!!errors.contactName}
            {...register("contactName")}
          />
        </FormField>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="contactEmail"
            label="Contact Email (optional)"
            error={errors.contactEmail?.message}
          >
            <FormInput
              id="contactEmail"
              type="email"
              placeholder="e.g., supplier@example.com"
              disabled={isSubmitting}
              error={!!errors.contactEmail}
              {...register("contactEmail")}
            />
          </FormField>

          <FormField
            id="contactPhone"
            label="Contact Phone (optional)"
            error={errors.contactPhone?.message}
            helperText="International format supported"
          >
            <FormInput
              id="contactPhone"
              type="tel"
              placeholder="e.g., +254 712 345678"
              disabled={isSubmitting}
              error={!!errors.contactPhone}
              {...register("contactPhone")}
            />
          </FormField>
        </div>
      </div>

      {/* Business & Certification Section */}
      <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Business & Certification
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="annualRevenueUsd"
            label="Annual Revenue (USD, optional)"
            error={errors.annualRevenueUsd?.message}
            helperText="Approximate annual revenue in USD"
          >
            <FormInput
              id="annualRevenueUsd"
              type="number"
              step="0.01"
              min="0"
              placeholder="e.g., 100000"
              disabled={isSubmitting}
              error={!!errors.annualRevenueUsd}
              {...register("annualRevenueUsd", { valueAsNumber: true })}
            />
          </FormField>

          <FormField
            id="chainOfCustodyRef"
            label="Chain of Custody Reference (optional)"
            error={errors.chainOfCustodyRef?.message}
            helperText="Certification or traceability reference"
          >
            <FormInput
              id="chainOfCustodyRef"
              type="text"
              placeholder="e.g., COC-2024-001"
              disabled={isSubmitting}
              error={!!errors.chainOfCustodyRef}
              {...register("chainOfCustodyRef")}
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
