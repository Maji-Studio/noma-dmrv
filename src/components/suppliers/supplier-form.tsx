/**
 * SupplierForm component
 * Reusable supplier form with React Hook Form integration
 * Used in both create and edit views for suppliers.
 *
 * Locations mirror the customer flow: in create mode the user builds a list of
 * pending source locations inline (persisted after the supplier is created); in
 * edit mode locations are managed live via React Query. Each location captures
 * its own coordinates through the map PositionPicker — the supplier record no
 * longer carries a single GPS position.
 */
"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon, TrashIcon, MapPinIcon } from "@phosphor-icons/react/dist/ssr";
import {
  DistanceCalcField,
  FormActions,
  FormField,
  FormInput,
  FormSection,
  FormTextarea,
  PositionPicker,
} from "@/components/forms";
import { useFacilityContext } from "@/hooks/use-facility-context";
import {
  useSupplierLocationsBySupplier,
  useDeleteSupplierLocation,
} from "@/hooks/use-suppliers";
import {
  supplierFormSchema,
  supplierLocationFormSchema,
  type SupplierFormData,
} from "@/schemas/suppliers";
import type { DistanceSourceValue } from "@/schemas/distance-source";
import type { Supplier } from "@/db/schema/parties";
import { isCertifyFormField } from "@/lib/certification/certify-field-registry";
import { Button } from "@/components/ui/button";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { SupplierLocationQuickAddDialog } from "./supplier-location-quick-add-dialog";

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
                      {loc.address ? `${loc.address} — ` : ""}
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

const INPUT_CLASS =
  "flex h-40 w-full border border-[var(--color-border-primary)] bg-[var(--color-background-white)] px-12 text-[var(--color-text-primary)] text-[var(--text-s)] transition-colors placeholder:text-[var(--color-text-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]";

function InlineLocationForm({
  onAdd,
  onCancel,
}: {
  onAdd: (loc: PendingSupplierLocation) => void;
  onCancel: () => void;
}) {
  const { selectedFacility } = useFacilityContext();
  const [formData, setFormData] = useState({
    name: "",
    country: "",
    stateRegion: "",
    city: "",
    address: "",
    gpsLatitude: null as number | null,
    gpsLongitude: null as number | null,
    distanceFromFacilityKm: null as number | null,
    distanceSource: null as DistanceSourceValue | null,
    isDefault: false,
  });
  const [formError, setFormError] = useState<string | null>(null);

  // CALC endpoints: this source location → the globally selected facility.
  const locationPoint =
    formData.gpsLatitude != null && formData.gpsLongitude != null
      ? { lat: formData.gpsLatitude, lng: formData.gpsLongitude }
      : null;
  const facilityPoint =
    selectedFacility?.gpsLatitude != null && selectedFacility?.gpsLongitude != null
      ? { lat: selectedFacility.gpsLatitude, lng: selectedFacility.gpsLongitude }
      : null;

  const handleAdd = () => {
    setFormError(null);

    const parsed = supplierLocationFormSchema.safeParse({
      name: formData.name.trim(),
      country: formData.country.trim(),
      stateRegion: formData.stateRegion.trim(),
      city: formData.city.trim(),
      address: formData.address.trim(),
      gpsLatitude: formData.gpsLatitude,
      gpsLongitude: formData.gpsLongitude,
      distanceFromFacilityKm: formData.distanceFromFacilityKm,
      distanceSource: formData.distanceSource,
      isDefault: formData.isDefault,
    });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? "Invalid location");
      return;
    }

    onAdd({
      name: parsed.data.name ?? "",
      country: parsed.data.country,
      stateRegion: parsed.data.stateRegion ?? "",
      city: parsed.data.city ?? "",
      address: parsed.data.address ?? "",
      gpsLatitude: parsed.data.gpsLatitude,
      gpsLongitude: parsed.data.gpsLongitude,
      distanceFromFacilityKm: parsed.data.distanceFromFacilityKm ?? null,
      distanceSource: parsed.data.distanceSource ?? null,
      isDefault: parsed.data.isDefault,
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
        <label htmlFor="pending-loc-name" className="body-small font-medium text-[var(--color-text-secondary)]">
          Name
        </label>
        <input
          id="pending-loc-name"
          type="text"
          value={formData.name}
          onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
          placeholder="e.g., Main Estate"
          className={INPUT_CLASS}
          autoFocus
        />
      </div>

      <div className="flex flex-col gap-6">
        <label htmlFor="pending-loc-country" className="body-small font-medium text-[var(--color-text-secondary)]">
          Country <span className="text-[var(--color-signal-red)]">*</span>
        </label>
        <input
          id="pending-loc-country"
          type="text"
          value={formData.country}
          onChange={(e) => setFormData((prev) => ({ ...prev, country: e.target.value }))}
          placeholder="e.g., Tanzania"
          className={INPUT_CLASS}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-16">
        <div className="flex flex-col gap-6">
          <label htmlFor="pending-loc-state" className="body-small font-medium text-[var(--color-text-secondary)]">
            State / Region
          </label>
          <input
            id="pending-loc-state"
            type="text"
            value={formData.stateRegion}
            onChange={(e) => setFormData((prev) => ({ ...prev, stateRegion: e.target.value }))}
            placeholder="e.g., Kilimanjaro"
            className={INPUT_CLASS}
          />
        </div>
        <div className="flex flex-col gap-6">
          <label htmlFor="pending-loc-city" className="body-small font-medium text-[var(--color-text-secondary)]">
            City
          </label>
          <input
            id="pending-loc-city"
            type="text"
            value={formData.city}
            onChange={(e) => setFormData((prev) => ({ ...prev, city: e.target.value }))}
            placeholder="e.g., Moshi"
            className={INPUT_CLASS}
          />
        </div>
      </div>

      <div className="flex flex-col gap-6">
        <label htmlFor="pending-loc-address" className="body-small font-medium text-[var(--color-text-secondary)]">
          Address / Description
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

      <PositionPicker
        idPrefix="pending-loc-gps"
        label="Source location position"
        accent="orange"
        required
        latitude={formData.gpsLatitude}
        longitude={formData.gpsLongitude}
        onPositionChange={({ lat, lng }) =>
          setFormData((prev) => ({ ...prev, gpsLatitude: lat, gpsLongitude: lng }))
        }
      />

      <DistanceCalcField
        id="pending-loc-distance"
        label="One-way distance to facility (per leg, km)"
        certifyRequired={isCertifyFormField("supplierLocation", "distanceFromFacilityKm")}
        certifyStatus="neutral"
        helperText="One-way road distance from this source location to the facility. Return trips are doubled at emissions time (set the trip type on each feedstock delivery)."
        distanceKm={formData.distanceFromFacilityKm}
        distanceSource={formData.distanceSource}
        onDistanceChange={(km, source) =>
          setFormData((prev) => ({
            ...prev,
            distanceFromFacilityKm: km,
            distanceSource: source,
          }))
        }
        origin={locationPoint}
        destination={facilityPoint}
        originLabel="source location position"
        destinationLabel="selected facility"
      />

      <label htmlFor="pending-loc-default" className="flex items-center gap-12 cursor-pointer">
        <input
          type="checkbox"
          id="pending-loc-default"
          className="h-[18px] w-[18px] border border-[var(--color-border-primary)] accent-[var(--clr-dark-purple)] cursor-pointer"
          checked={formData.isDefault}
          onChange={(e) => setFormData((prev) => ({ ...prev, isDefault: e.target.checked }))}
        />
        <span className="body-medium text-[var(--color-text-primary)]">
          Set as default source location
        </span>
      </label>

      <div className="flex gap-12 justify-start pt-8">
        <Button variant="primary" size="small" onClick={handleAdd}>
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

function LocationsSection({ supplierId }: { supplierId: string }) {
  const [showAddDialog, setShowAddDialog] = useState(false);
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
        <p
          className="body-small text-[var(--color-signal-red)]"
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
        >
          Failed to load locations. Please try refreshing.
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
                aria-label={`Delete ${loc.name || loc.country}`}
              >
                <TrashIcon size={16} />
              </Button>
            </div>
          ))}
        </div>
      )}

      <SupplierLocationQuickAddDialog
        isOpen={showAddDialog}
        onClose={() => setShowAddDialog(false)}
        supplierId={supplierId}
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
