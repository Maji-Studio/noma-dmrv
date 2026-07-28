/**
 * CustomerForm component
 * Reusable customer form with React Hook Form integration
 * Used in both create and edit views for customers
 */
"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon, TrashIcon, MapPinIcon } from "@phosphor-icons/react/dist/ssr";
import { FormField, FormInput, FormTextarea, FormActions, FormSection } from "@/components/forms";
import {
  customerFormSchema,
  customerLocationFormSchema,
  type CustomerFormData,
  type CustomerLocationFormData,
  type CustomerLocationFormInput,
} from "@/schemas/customers";
import type { Customer } from "@/db/schema/parties";
import { useCustomerLocations, useDeleteCustomerLocation } from "@/hooks/use-customers";
import { useOrganizationDefaultValues } from "@/hooks/use-organization-settings";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { Button } from "@/components/ui/button";
import { CustomerLocationQuickAddDialog } from "./customer-location-quick-add-dialog";
import { CustomerLocationFields } from "./customer-location-fields";

// ============================================
// Types
// ============================================

export type PendingLocation = CustomerLocationFormData;

function formatPendingLocationSummary({
  city,
  stateRegion,
  country,
}: Pick<PendingLocation, "city" | "stateRegion" | "country">): string | null {
  const parts = [city, stateRegion, country]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));

  return parts.length > 0 ? parts.join(", ") : null;
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
  /** Submission-level error shown with the action footer */
  errorMessage?: string;
  /** Custom label for the submit button */
  submitLabel?: string;
}

export function CustomerForm({
  customer,
  customerId,
  onSubmit,
  onCancel,
  isSubmitting = false,
  errorMessage,
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
      <FormSection title="Required information" divider={false}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField id="name" label="Customer name" error={errors.name?.message} required>
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
      </FormSection>

      {/* Locations Section */}
      {isEditMode && customerId ? (
        <LocationsSection customerId={customerId} />
      ) : (
        <CreateModeLocationsSection
          locations={pendingLocations}
          onAdd={handleAddPendingLocation}
          onRemove={handleRemovePendingLocation}
          error={locationError}
        />
      )}

      {/* Contact Information Section */}
      <FormSection title="Contact information">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField id="contactEmail" label="Contact email" error={errors.contactEmail?.message}>
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
            label="Contact phone"
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
      </FormSection>

      {/* Business Information Section */}
      <FormSection title="Business information">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="cropType"
            label="Crop type"
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
      </FormSection>

      <FormActions
        onCancel={onCancel}
        isSubmitting={isSubmitting}
        errorMessage={errorMessage}
        submitLabel={submitLabel}
        defaultSubmitLabel={defaultSubmitLabel}
      />
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
    <FormSection
      title={
        <>
          Locations <span className="text-[var(--color-signal-red)]">*</span>
        </>
      }
      actions={
        <Button
          variant="noOutline"
          size="small"
          onClick={() => setShowForm(true)}
          className="text-[var(--color-interaction)]"
        >
          <PlusIcon size={14} weight="bold" />
          Add Location
        </Button>
      }
    >
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
          {locations.map((loc, index) => {
            const locationSummary = formatPendingLocationSummary(loc);

            return (
              <div
                key={index}
                className="flex items-center justify-between gap-12 px-12 py-8 border border-[var(--color-border-tertiary)] bg-[var(--color-surface-light)]"
              >
                <div className="flex items-center gap-10 min-w-0">
                  <MapPinIcon size={16} className="shrink-0 text-[var(--color-text-tertiary)]" />
                  <div className="min-w-0">
                    <p className="body-small font-medium truncate">{loc.name}</p>
                    {locationSummary ? (
                      <p className="text-[var(--text-xs)] text-[var(--color-text-tertiary)] truncate">
                        {locationSummary}
                      </p>
                    ) : null}
                    <p className="text-[var(--text-xs)] text-[var(--color-text-tertiary)] truncate">
                      {loc.address}
                      {` — ${loc.gpsLatitude.toFixed(4)}, ${loc.gpsLongitude.toFixed(4)}`}
                    </p>
                  </div>
                </div>
                <Button
                  variant="destructive"
                  size="icon"
                  onClick={() => onRemove(index)}
                  className="shrink-0"
                  aria-label={`Remove ${loc.name}`}
                >
                  <TrashIcon size={16} />
                </Button>
              </div>
            );
          })}
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
    </FormSection>
  );
}

// ============================================
// Inline Location Form (for create mode)
// ============================================

function InlineLocationForm({ onAdd, onCancel }: { onAdd: (loc: PendingLocation) => void; onCancel: () => void }) {
  // Organization operating defaults seed create mode only; an existing record
  // always wins. Server-seeded in the `(app)` layout, so this is synchronous.
  const { defaults: orgDefaults } = useOrganizationDefaultValues();
  const form = useForm<
    CustomerLocationFormInput,
    unknown,
    CustomerLocationFormData
  >({
    resolver: zodResolver(customerLocationFormSchema),
    defaultValues: {
      name: "",
      country: orgDefaults.defaultCountry ?? "",
      stateRegion: "",
      city: "",
      address: "",
      gpsLatitude: undefined,
      gpsLongitude: undefined,
      distanceFromFacilityKm: undefined,
      distanceSource: null,
      defaultSoilTemperatureC: undefined,
      isDefault: false,
    },
  });

  return (
    <div
      className="space-y-20 border border-[var(--color-border-primary)] bg-[var(--color-surface-light)] p-16"
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
      <CustomerLocationFields form={form} idPrefix="pending-loc" />

      <div className="flex gap-12 justify-start pt-8">
        <Button
          variant="primary"
          size="small"
          onClick={form.handleSubmit(onAdd)}
        >
          Add Location
        </Button>
        <Button variant="default" size="small" onClick={onCancel}>
          Cancel
        </Button>
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
    <FormSection
      title="Locations"
      actions={
        <Button
          variant="noOutline"
          size="small"
          onClick={() => setShowAddDialog(true)}
          className="text-[var(--color-interaction)]"
        >
          <PlusIcon size={14} weight="bold" />
          Add Location
        </Button>
      }
    >
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
                <MapPinIcon size={16} className="shrink-0 text-[var(--color-text-tertiary)]" />
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
              <Button
                variant="destructive"
                size="icon"
                onClick={() => setDeletingLocationId(loc.id)}
                className="shrink-0"
                aria-label={`Delete ${loc.name}`}
              >
                <TrashIcon size={16} />
              </Button>
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
    </FormSection>
  );
}
