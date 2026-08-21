/**
 * SupplierForm component
 * Reusable supplier form with React Hook Form integration
 * Used in both create and edit views for suppliers.
 *
 * Locations mirror the customer flow: in create mode the user builds a list of
 * pending source locations in a nested dialog (persisted after the supplier is
 * created); in
 * edit mode locations are managed live via React Query. Each location captures
 * its own coordinates through the map PositionPicker — the supplier record no
 * longer carries a single GPS position.
 */
"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  MapPinIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react/dist/ssr";
import {
  FormActions,
  FormField,
  FormInput,
  FormSection,
  FormTextarea,
} from "@/components/forms";
import { QuickAddDialogShell } from "@/components/forms/entity-select/quick-add-dialog-shell";
import {
  useSupplierLocationsBySupplier,
  useDeleteSupplierLocation,
} from "@/hooks/use-suppliers";
import {
  supplierFormSchema,
  type SupplierFormData,
  type SupplierLocationFormData,
} from "@/schemas/suppliers";
import type { DistanceSourceValue } from "@/schemas/distance-source";
import type { Supplier, SupplierLocation } from "@/db/schema/parties";
import { Button } from "@/components/ui/button";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { SupplierLocationDialog } from "./supplier-location-dialog";
import { SupplierLocationForm } from "./supplier-location-form";

// ============================================
// Types
// ============================================

export interface PendingSupplierLocation {
  name: string;
  country: string;
  stateRegion: string;
  city: string;
  address: string;
  gpsLatitude: number;
  gpsLongitude: number;
  // Road distance (km) from this source location to the delivery facility.
  distanceFromFacilityKm: number | null;
  distanceSource: DistanceSourceValue | null;
  // Marks this as the supplier's default source location.
  isDefault: boolean;
}

function normalizePendingSupplierLocation(
  location: SupplierLocationFormData,
): PendingSupplierLocation {
  return {
    name: location.name ?? "",
    country: location.country,
    stateRegion: location.stateRegion ?? "",
    city: location.city ?? "",
    address: location.address ?? "",
    gpsLatitude: location.gpsLatitude,
    gpsLongitude: location.gpsLongitude,
    distanceFromFacilityKm: location.distanceFromFacilityKm ?? null,
    distanceSource: location.distanceSource ?? null,
    isDefault: location.isDefault,
  };
}

function formatPendingLocationSummary({
  city,
  stateRegion,
  country,
}: Pick<PendingSupplierLocation, "city" | "stateRegion" | "country">): string | null {
  const parts = [city, stateRegion, country]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));

  return parts.length > 0 ? parts.join(", ") : null;
}

// ============================================
// Component
// ============================================

interface SupplierFormProps {
  /** Existing supplier data for editing (undefined for create mode) */
  supplier?: Supplier;
  /** Supplier ID — passed separately so the locations section renders in edit mode */
  supplierId?: string;
  /** Form submission handler */
  onSubmit: (
    data: SupplierFormData,
    pendingLocations?: PendingSupplierLocation[]
  ) => Promise<void> | void;
  /** Cancel button handler */
  onCancel?: () => void;
  /** Whether the form is currently submitting */
  isSubmitting?: boolean;
  /** Submission-level error shown with the action footer */
  errorMessage?: string;
  /** Custom label for the submit button */
  submitLabel?: string;
}

export function SupplierForm({
  supplier,
  supplierId,
  onSubmit,
  onCancel,
  isSubmitting = false,
  errorMessage,
  submitLabel,
}: SupplierFormProps) {
  const isEditMode = !!supplier;
  const [pendingLocations, setPendingLocations] = useState<PendingSupplierLocation[]>([]);
  const [locationError, setLocationError] = useState<string | null>(null);

  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(supplierFormSchema),
    defaultValues: {
      name: supplier?.name ?? "",
      location: supplier?.location ?? "",
      // Supplier-level coordinates/distance are legacy: preserved on edit but no
      // longer edited here — coordinates now live per source location.
      gpsLatitude: supplier?.gpsLatitude ?? null,
      gpsLongitude: supplier?.gpsLongitude ?? null,
      address: supplier?.address ?? "",
      contactName: supplier?.contactName ?? "",
      contactEmail: supplier?.contactEmail ?? "",
      contactPhone: supplier?.contactPhone ?? "",
      sourceRegion: supplier?.sourceRegion ?? "",
      distanceToFacilityKm: supplier?.distanceToFacilityKm ?? undefined,
      distanceSource: supplier?.distanceSource ?? null,
    },
  });

  const defaultSubmitLabel = isEditMode ? "Update Supplier" : "Create Supplier";

  // Locations are managed live (edit) only when we actually hold the supplier's
  // id; otherwise they are collected as a pending list to persist after create.
  // Render and submit MUST agree on this single condition — a supplier passed
  // without an id would otherwise show the pending-list builder yet drop it here.
  const managesLiveLocations = isEditMode && !!supplierId;

  const handleFormSubmit = handleSubmit((data) => {
    if (!managesLiveLocations && pendingLocations.length === 0) {
      setLocationError("At least one location is required");
      return;
    }
    setLocationError(null);
    onSubmit(
      data as SupplierFormData,
      managesLiveLocations ? undefined : pendingLocations
    );
  });

  const handleAddPendingLocation = (loc: PendingSupplierLocation) => {
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
          <FormField
            id="name"
            label="Supplier name"
            required
            error={errors.name?.message}
          >
            <FormInput
              id="name"
              type="text"
              placeholder="e.g., Agricultural Residues Co-op"
              disabled={isSubmitting}
              error={!!errors.name}
              {...register("name")}
            />
          </FormField>
        </div>
      </FormSection>

      {/* Locations Section */}
      {managesLiveLocations && supplierId ? (
        <LocationsSection supplierId={supplierId} />
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
          <FormField
            id="contactName"
            label="Contact name"
            error={errors.contactName?.message}
          >
            <FormInput
              id="contactName"
              type="text"
              placeholder="e.g., Feedstock Coordinator"
              disabled={isSubmitting}
              error={!!errors.contactName}
              {...register("contactName")}
            />
          </FormField>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="contactEmail"
            label="Contact email"
            error={errors.contactEmail?.message}
          >
            <FormInput
              id="contactEmail"
              type="email"
              placeholder="e.g., procurement.partner@example.com"
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

      {/* Sourcing Information Section */}
      <FormSection title="Sourcing information">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="location"
            label="Location"
            error={errors.location?.message}
            helperText="General location or region of the supplier"
          >
            <FormInput
              id="location"
              type="text"
              placeholder="e.g., Northern Tanzania"
              disabled={isSubmitting}
              error={!!errors.location}
              {...register("location")}
            />
          </FormField>

          <FormField
            id="sourceRegion"
            label="Source region"
            error={errors.sourceRegion?.message}
            helperText="Feedstock sourcing region (used for Isometric SC assessment)"
          >
            <FormInput
              id="sourceRegion"
              type="text"
              placeholder="e.g., Kilimanjaro"
              disabled={isSubmitting}
              error={!!errors.sourceRegion}
              {...register("sourceRegion")}
            />
          </FormField>

          <div className="md:col-span-2">
            <FormField id="address" label="Address" error={errors.address?.message}>
              <FormTextarea
                id="address"
                placeholder="Supplier yard, collection center, or cooperative address"
                disabled={isSubmitting}
                error={!!errors.address}
                {...register("address")}
              />
            </FormField>
          </div>
        </div>
      </FormSection>

      <FormActions
        control={control}
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
  locations: PendingSupplierLocation[];
  onAdd: (loc: PendingSupplierLocation) => void;
  onRemove: (index: number) => void;
  error: string | null;
}) {
  const [isLocationDialogOpen, setIsLocationDialogOpen] = useState(false);

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
          onClick={() => setIsLocationDialogOpen(true)}
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

      {locations.length === 0 ? (
        <p className="body-small text-[var(--color-text-tertiary)]">
          No locations yet. Add at least one source location for this supplier.
        </p>
      ) : (
        <div className="flex flex-col gap-8">
          {locations.map((loc, index) => {
            const locationSummary = formatPendingLocationSummary(loc);
            const title = loc.name || loc.city || loc.country || "Location";

            return (
              <div
                key={index}
                className="flex items-center justify-between gap-12 px-12 py-8 border border-[var(--color-border-tertiary)] bg-[var(--color-surface-light)]"
              >
                <div className="flex items-center gap-10 min-w-0">
                  <MapPinIcon size={16} className="shrink-0 text-[var(--color-text-tertiary)]" />
                  <div className="min-w-0">
                    <p className="body-small font-medium truncate">{title}</p>
                    {locationSummary ? (
                      <p className="text-[var(--text-xs)] text-[var(--color-text-tertiary)] truncate">
                        {locationSummary}
                      </p>
                    ) : null}
                    <p className="text-[var(--text-xs)] text-[var(--color-text-tertiary)] truncate">
                      {loc.address ? `${loc.address}, ` : ""}
                      {`${loc.gpsLatitude.toFixed(4)}, ${loc.gpsLongitude.toFixed(4)}`}
                    </p>
                  </div>
                </div>
                <Button
                  variant="destructive"
                  size="icon"
                  onClick={() => onRemove(index)}
                  className="shrink-0"
                  aria-label={`Remove ${title}`}
                >
                  <TrashIcon size={16} />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      <QuickAddDialogShell
        isOpen={isLocationDialogOpen}
        onClose={() => setIsLocationDialogOpen(false)}
        title="Add Location"
        width="lg"
        testId="supplier-location-quick-add-dialog"
      >
        <SupplierLocationForm
          idPrefix="pending-loc"
          onSubmit={(location) => {
            onAdd(normalizePendingSupplierLocation(location));
            setIsLocationDialogOpen(false);
          }}
          onCancel={() => setIsLocationDialogOpen(false)}
        />
      </QuickAddDialogShell>
    </FormSection>
  );
}

// ============================================
// Locations Section (edit mode only)
// ============================================

function LocationsSection({ supplierId }: { supplierId: string }) {
  // `editingLocation` is deliberately not cleared on close: the modal keeps its
  // subtree mounted for the exit transition, so clearing it there would flip the
  // dialog title and submit label to the "Add" wording mid-fade. Opening the add
  // dialog clears it instead.
  const [isLocationDialogOpen, setIsLocationDialogOpen] = useState(false);
  const [editingLocation, setEditingLocation] =
    useState<SupplierLocation | null>(null);
  const [deletingLocationId, setDeletingLocationId] = useState<string | null>(null);

  const { data: locations, isLoading, isError } = useSupplierLocationsBySupplier(supplierId);
  const deleteLocation = useDeleteSupplierLocation(supplierId);

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
          onClick={() => {
            setEditingLocation(null);
            setIsLocationDialogOpen(true);
          }}
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
        <p
          className="body-small text-[var(--color-signal-red)]"
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
        >
          Locations could not be loaded. Refresh the page and try again.
        </p>
      ) : !locations || locations.length === 0 ? (
        <p className="body-small text-[var(--color-text-tertiary)]">
          No locations yet. Add one to track where this supplier sources feedstock.
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
                  <p className="body-small font-medium truncate">{loc.name || loc.country}</p>
                  <p className="text-[var(--text-xs)] text-[var(--color-text-tertiary)] truncate">
                    {loc.address || "Location not set"}
                    {loc.gpsLatitude !== null && loc.gpsLongitude !== null
                      ? `, ${loc.gpsLatitude.toFixed(4)}, ${loc.gpsLongitude.toFixed(4)}`
                      : ""}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-8">
                <Button
                  variant="noOutline"
                  size="icon"
                  onClick={() => {
                    setEditingLocation(loc);
                    setIsLocationDialogOpen(true);
                  }}
                  aria-label={`Edit ${loc.name || loc.country}`}
                >
                  <PencilIcon size={16} />
                </Button>
                <Button
                  variant="destructive"
                  size="icon"
                  onClick={() => setDeletingLocationId(loc.id)}
                  aria-label={`Delete ${loc.name || loc.country}`}
                >
                  <TrashIcon size={16} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <SupplierLocationDialog
        isOpen={isLocationDialogOpen}
        onClose={() => setIsLocationDialogOpen(false)}
        supplierId={supplierId}
        location={editingLocation ?? undefined}
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
