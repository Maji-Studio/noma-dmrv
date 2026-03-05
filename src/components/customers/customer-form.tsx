/**
 * CustomerForm component
 * Reusable customer form with React Hook Form integration
 * Used in both create and edit views for customers
 */
"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash, MapPin } from "@phosphor-icons/react";
import { FormField, FormInput, FormTextarea } from "@/components/forms";
import { Button } from "@/components/ui";
import {
  customerFormSchema,
  type CustomerFormData,
} from "@/schemas/customers";
import type { Customer } from "@/db/schema/parties";
import {
  useCustomerLocations,
  useDeleteCustomerLocation,
} from "@/hooks/use-customers";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { CustomerLocationQuickAddDialog } from "./customer-location-quick-add-dialog";

// ============================================
// Component
// ============================================

interface CustomerFormProps {
  /** Existing customer data for editing (undefined for create mode) */
  customer?: Customer;
  /** Customer ID — passed separately so locations section renders in edit mode */
  customerId?: string;
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
  customerId,
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
            required
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

      {/* Contact Information Section */}
      <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Contact Information
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="contactEmail"
            label="Contact Email"
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
            label="Contact Phone"
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

      {/* Business Information Section */}
      <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Business Information
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="cropType"
            label="Crop Type"
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
            label="Address"
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
      </div>

      {/* Locations Section — only in edit mode */}
      {customerId && (
        <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
          <LocationsSection customerId={customerId} />
        </div>
      )}

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

// ============================================
// Locations Section (edit mode only)
// ============================================

function LocationsSection({ customerId }: { customerId: string }) {
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [deletingLocationId, setDeletingLocationId] = useState<string | null>(
    null
  );

  const { data: locations, isLoading } = useCustomerLocations(customerId);
  const deleteLocation = useDeleteCustomerLocation(customerId);

  const handleDeleteConfirm = async () => {
    if (!deletingLocationId) return;
    try {
      await deleteLocation.mutateAsync(deletingLocationId);
      setDeletingLocationId(null);
    } catch {
      // Error is handled by the mutation hook
      setDeletingLocationId(null);
    }
  };

  return (
    <>
      <div className="flex items-center justify-between">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Locations
        </h3>
        <button
          type="button"
          onClick={() => setShowAddDialog(true)}
          className="inline-flex items-center gap-6 px-10 py-4 text-[var(--text-s)] font-medium text-[var(--color-interaction)] hover:bg-[var(--color-interaction)]/10 transition-colors"
        >
          <Plus size={14} weight="bold" />
          Add Location
        </button>
      </div>

      {isLoading ? (
        <p className="body-small text-[var(--color-text-tertiary)]">
          Loading locations...
        </p>
      ) : !locations || locations.length === 0 ? (
        <p className="body-small text-[var(--color-text-tertiary)]">
          No locations yet. Add one to use in orders and deliveries.
        </p>
      ) : (
        <div className="flex flex-col gap-8">
          {locations.map((loc) => (
            <div
              key={loc.id}
              className="flex items-center justify-between gap-12 px-12 py-8 border border-[var(--color-border-tertiary)] bg-[var(--color-surface-light)]"
            >
              <div className="flex items-center gap-10 min-w-0">
                <MapPin
                  size={16}
                  className="shrink-0 text-[var(--color-text-tertiary)]"
                />
                <div className="min-w-0">
                  <p className="body-small font-medium truncate">{loc.name}</p>
                  <p className="text-[var(--text-xs)] text-[var(--color-text-tertiary)] truncate">
                    {loc.gpsLatitude.toFixed(4)}, {loc.gpsLongitude.toFixed(4)}
                    {loc.address ? ` — ${loc.address}` : ""}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDeletingLocationId(loc.id)}
                className="shrink-0 p-4 text-[var(--color-text-tertiary)] hover:text-[var(--color-signal-red)] transition-colors"
                aria-label={`Delete ${loc.name}`}
              >
                <Trash size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      <CustomerLocationQuickAddDialog
        isOpen={showAddDialog}
        onClose={() => setShowAddDialog(false)}
        customerId={customerId}
      />

      <DeleteConfirmDialog
        isOpen={!!deletingLocationId}
        title="Delete Location"
        message="Are you sure you want to delete this location? This action cannot be undone."
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeletingLocationId(null)}
        isPending={deleteLocation.isPending}
      />
    </>
  );
}
