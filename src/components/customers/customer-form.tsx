/**
 * CustomerForm component
 * Reusable customer form with React Hook Form integration
 * Used in both create and edit views for customers
 */
"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormField, FormInput, FormTextarea } from "@/components/forms";
import { Button } from "@/components/ui";
import {
  customerFormSchema,
  type CustomerFormData,
} from "@/schemas/customers";
import type { Customer } from "@/db/schema/parties";

// ============================================
// Component
// ============================================

interface CustomerFormProps {
  /** Existing customer data for editing (undefined for create mode) */
  customer?: Customer;
  /** Form submission handler */
  onSubmit: (data: CustomerFormData) => Promise<void> | void;
  /** Cancel button handler */
  onCancel?: () => void;
  /** Whether the form is currently submitting */
  isSubmitting?: boolean;
  /** Custom label for the submit button */
  submitLabel?: string;
}

export function CustomerForm({
  customer,
  onSubmit,
  onCancel,
  isSubmitting = false,
  submitLabel,
}: CustomerFormProps) {
  const isEditMode = !!customer;

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(customerFormSchema),
    defaultValues: {
      name: customer?.name ?? "",
      cropType: customer?.cropType ?? "",
      address: customer?.address ?? "",
      contactEmail: customer?.contactEmail ?? "",
      contactPhone: customer?.contactPhone ?? "",
    },
  });

  const defaultSubmitLabel = isEditMode ? "Update Customer" : "Create Customer";

  const handleFormSubmit = handleSubmit((data) => {
    onSubmit(data as CustomerFormData);
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
            id="name"
            label="Customer Name"
            error={errors.name?.message}
          >
            <FormInput
              id="name"
              type="text"
              placeholder="e.g., Smith Farm"
              disabled={isSubmitting}
              error={!!errors.name}
              {...register("name")}
            />
          </FormField>
        </div>
      </div>

      {/* Business Information Section */}
      <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Business Information
        </h3>

        <FormField
          id="cropType"
          label="Crop Type (optional)"
          error={errors.cropType?.message}
          helperText="Primary crop grown by this customer"
        >
          <FormInput
            id="cropType"
            type="text"
            placeholder="e.g., Coffee, Maize, Tea"
            disabled={isSubmitting}
            error={!!errors.cropType}
            {...register("cropType")}
          />
        </FormField>

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

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="contactEmail"
            label="Contact Email (optional)"
            error={errors.contactEmail?.message}
          >
            <FormInput
              id="contactEmail"
              type="email"
              placeholder="e.g., customer@example.com"
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
