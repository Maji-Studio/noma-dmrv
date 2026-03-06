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
import { customerFormSchema, type CustomerFormData } from "@/schemas/customers";
import type { Customer } from "@/db/schema/parties";
import { useCustomerLocations, useDeleteCustomerLocation } from "@/hooks/use-customers";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { CustomerLocationQuickAddDialog } from "./customer-location-quick-add-dialog";

// ============================================
// Types
// ============================================

export interface PendingLocation {
  name: string;
  address: string;
  gpsLatitude: number | null;
  gpsLongitude: number | null;
}

// ============================================
// Component
// ============================================

interface CustomerFormProps {
  /** Existing customer data for editing (undefined for create mode) */
  customer?: Customer;
  /** Customer ID — passed separately so locations section renders in edit mode */
  customerId?: string;
  /** Form submission handler */
  onSubmit: (data: CustomerFormData, pendingLocations?: PendingLocation[]) => Promise<void> | void;
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
  const [pendingLocations, setPendingLocations] = useState<PendingLocation[]>([]);
  const [locationError, setLocationError] = useState<string | null>(null);

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
    if (!isEditMode && pendingLocations.length === 0) {
      setLocationError("At least one location is required");
      return;
    }
    setLocationError(null);
    onSubmit(data as CustomerFormData, isEditMode ? undefined : pendingLocations);
  });

  const handleAddPendingLocation = (loc: PendingLocation) => {
    setPendingLocations((prev) => [...prev, loc]);
    setLocationError(null);
  };

  const handleRemovePendingLocation = (index: number) => {
    setPendingLocations((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <form onSubmit={handleFormSubmit} className="space-y-20">
      {/* Required Fields Section */}
      <div className="space-y-20">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Required Information
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField id="name" label="Customer Name" error={errors.name?.message} required>
            <FormInput
              id="name"
              type="text"
              placeholder="e.g., Regenerative Farm Partner"
              disabled={isSubmitting}
              error={!!errors.name}
              {...register("name")}
            />
          </FormField>
        </div>
      </div>

      {/* Locations Section */}
      {isEditMode && customerId ? (
        <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
          <LocationsSection customerId={customerId} />
        </div>
      ) : (
        <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
          <CreateModeLocationsSection
            locations={pendingLocations}
            onAdd={handleAddPendingLocation}
            onRemove={handleRemovePendingLocation}
            error={locationError}
          />
        </div>
      )}

      {/* Contact Information Section */}
      <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Contact Information
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField id="contactEmail" label="Contact Email" error={errors.contactEmail?.message}>
            <FormInput
              id="contactEmail"
              type="email"
              placeholder="e.g., field.partner@example.com"
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
              placeholder="e.g., +255 754 000 000"
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
            helperText="Primary crop or land use for this biochar application site"
          >
            <FormInput
              id="cropType"
              type="text"
              placeholder="e.g., Coffee, maize, vegetables"
              disabled={isSubmitting}
              error={!!errors.cropType}
              {...register("cropType")}
            />
          </FormField>

          <div className="md:col-span-2">
            <FormField id="address" label="Address" error={errors.address?.message}>
              <FormTextarea
                id="address"
                placeholder="Farm, nursery, or project site address"
                disabled={isSubmitting}
                error={!!errors.address}
                {...register("address")}
              />
            </FormField>
          </div>
        </div>
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

// ============================================
// Create Mode Locations Section
// ============================================

function CreateModeLocationsSection({
  locations,
  onAdd,
  onRemove,
  error,
}: {
  locations: PendingLocation[];
  onAdd: (loc: PendingLocation) => void;
  onRemove: (index: number) => void;
  error: string | null;
}) {
  const [showForm, setShowForm] = useState(false);

  return (
    <>
      <div className="flex items-center justify-between">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Locations <span className="text-[var(--color-signal-red)]">*</span>
        </h3>
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-6 px-10 py-4 text-[var(--text-s)] font-medium text-[var(--color-interaction)] hover:bg-[var(--color-interaction)]/10 transition-colors"
        >
          <Plus size={14} weight="bold" />
          Add Location
        </button>
      </div>

      {error && (
        <p className="text-[var(--text-s)] text-[var(--color-signal-red)]" role="alert">
          {error}
        </p>
      )}

      {locations.length === 0 && !showForm ? (
        <p className="body-small text-[var(--color-text-tertiary)]">
          No locations yet. Add at least one location for this customer.
        </p>
      ) : (
        <div className="flex flex-col gap-8">
          {locations.map((loc, index) => (
            <div
              key={index}
              className="flex items-center justify-between gap-12 px-12 py-8 border border-[var(--color-border-tertiary)] bg-[var(--color-surface-light)]"
            >
              <div className="flex items-center gap-10 min-w-0">
                <MapPin size={16} className="shrink-0 text-[var(--color-text-tertiary)]" />
                <div className="min-w-0">
                  <p className="body-small font-medium truncate">{loc.name}</p>
                  <p className="text-[var(--text-xs)] text-[var(--color-text-tertiary)] truncate">
                    {loc.address}
                    {loc.gpsLatitude !== null && loc.gpsLongitude !== null
                      ? ` — ${loc.gpsLatitude.toFixed(4)}, ${loc.gpsLongitude.toFixed(4)}`
                      : ""}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onRemove(index)}
                className="shrink-0 p-4 text-[var(--color-text-tertiary)] hover:text-[var(--color-signal-red)] transition-colors"
                aria-label={`Remove ${loc.name}`}
              >
                <Trash size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <InlineLocationForm
          onAdd={(loc) => {
            onAdd(loc);
            setShowForm(false);
          }}
          onCancel={() => setShowForm(false)}
        />
      )}
    </>
  );
}

// ============================================
// Inline Location Form (for create mode)
// ============================================

const INPUT_CLASS =
  "flex h-40 w-full border border-[var(--color-border-primary)] bg-[var(--color-background-white)] px-12 text-[var(--color-text-primary)] text-[var(--text-s)] transition-colors placeholder:text-[var(--color-text-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]";

function InlineLocationForm({ onAdd, onCancel }: { onAdd: (loc: PendingLocation) => void; onCancel: () => void }) {
  const [formData, setFormData] = useState({
    name: "",
    address: "",
    gpsLatitude: "",
    gpsLongitude: "",
  });
  const [formError, setFormError] = useState<string | null>(null);

  const handleAdd = () => {
    setFormError(null);

    if (!formData.name.trim()) {
      setFormError("Location name is required");
      return;
    }
    if (!formData.address.trim()) {
      setFormError("Location address is required");
      return;
    }

    const lat = formData.gpsLatitude.trim() === "" ? null : Number(formData.gpsLatitude);
    const lng = formData.gpsLongitude.trim() === "" ? null : Number(formData.gpsLongitude);

    if (lat !== null && (Number.isNaN(lat) || lat < -90 || lat > 90)) {
      setFormError("Latitude must be between -90 and 90");
      return;
    }
    if (lng !== null && (Number.isNaN(lng) || lng < -180 || lng > 180)) {
      setFormError("Longitude must be between -180 and 180");
      return;
    }

    onAdd({
      name: formData.name.trim(),
      address: formData.address.trim(),
      gpsLatitude: lat,
      gpsLongitude: lng,
    });
  };

  return (
    <div
      className="p-16 border border-[var(--color-border-primary)] bg-[var(--color-surface-light)] flex flex-col gap-16"
      onKeyDown={(e) => {
        if (
          e.key === "Enter" &&
          e.target instanceof HTMLInputElement &&
          ["text", "number", "search", "email", "tel", "url"].includes(e.target.type)
        ) {
          e.preventDefault();
        }
      }}
    >
      {formError && (
        <p className="text-[var(--text-s)] text-[var(--color-signal-red)]" role="alert">
          {formError}
        </p>
      )}

      <div className="flex flex-col gap-6">
        <label htmlFor="pending-loc-name" className="label-medium">
          Name <span className="text-[var(--color-signal-red)]">*</span>
        </label>
        <input
          id="pending-loc-name"
          type="text"
          value={formData.name}
          onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
          placeholder="e.g., Demonstration Plot A"
          className={INPUT_CLASS}
          autoFocus
        />
      </div>

      <div className="flex flex-col gap-6">
        <label htmlFor="pending-loc-address" className="label-medium">
          Location <span className="text-[var(--color-signal-red)]">*</span>
        </label>
        <input
          id="pending-loc-address"
          type="text"
          value={formData.address}
          onChange={(e) => setFormData((prev) => ({ ...prev, address: e.target.value }))}
          placeholder="e.g., Moshi Rural District, Kilimanjaro Region"
          className={INPUT_CLASS}
        />
      </div>

      <div className="grid grid-cols-2 gap-16">
        <div className="flex flex-col gap-6">
          <label htmlFor="pending-loc-lat" className="label-medium">
            GPS Latitude
          </label>
          <input
            id="pending-loc-lat"
            type="number"
            step="any"
            min="-90"
            max="90"
            value={formData.gpsLatitude}
            onChange={(e) =>
              setFormData((prev) => ({
                ...prev,
                gpsLatitude: e.target.value,
              }))
            }
            placeholder="e.g., -3.3349"
            className={INPUT_CLASS}
          />
        </div>
        <div className="flex flex-col gap-6">
          <label htmlFor="pending-loc-lng" className="label-medium">
            GPS Longitude
          </label>
          <input
            id="pending-loc-lng"
            type="number"
            step="any"
            min="-180"
            max="180"
            value={formData.gpsLongitude}
            onChange={(e) =>
              setFormData((prev) => ({
                ...prev,
                gpsLongitude: e.target.value,
              }))
            }
            placeholder="e.g., 37.3404"
            className={INPUT_CLASS}
          />
        </div>
      </div>

      <div className="flex gap-12 justify-end pt-8">
        <button
          type="button"
          onClick={onCancel}
          className="h-36 px-12 border border-[var(--color-border-primary)] hover:bg-[var(--color-background-medium)] text-[var(--text-s)]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleAdd}
          className="h-36 px-12 bg-[var(--color-interaction)] text-white hover:opacity-90 text-[var(--text-s)]"
        >
          Add Location
        </button>
      </div>
    </div>
  );
}

// ============================================
// Locations Section (edit mode only)
// ============================================

function LocationsSection({ customerId }: { customerId: string }) {
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [deletingLocationId, setDeletingLocationId] = useState<string | null>(null);

  const { data: locations, isLoading, isError } = useCustomerLocations(customerId);
  const deleteLocation = useDeleteCustomerLocation(customerId);

  const handleDeleteConfirm = async () => {
    if (!deletingLocationId) return;
    try {
      await deleteLocation.mutateAsync(deletingLocationId);
      setDeletingLocationId(null);
    } catch {
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
        <p className="body-small text-[var(--color-text-tertiary)]">Loading locations...</p>
      ) : isError ? (
        <p className="body-small text-[var(--color-signal-red)]" role="alert" aria-live="assertive" aria-atomic="true">
          Failed to load locations. Please try refreshing.
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
                <MapPin size={16} className="shrink-0 text-[var(--color-text-tertiary)]" />
                <div className="min-w-0">
                  <p className="body-small font-medium truncate">{loc.name}</p>
                  <p className="text-[var(--text-xs)] text-[var(--color-text-tertiary)] truncate">
                    {loc.address || "Location not set"}
                    {loc.gpsLatitude !== null && loc.gpsLongitude !== null
                      ? ` — ${loc.gpsLatitude.toFixed(4)}, ${loc.gpsLongitude.toFixed(4)}`
                      : ""}
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
