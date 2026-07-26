/**
 * SupplierDetail component
 * Supplier detail view with nested locations management
 * Includes inline create/edit forms for locations and delete confirmation
 */
"use client";

import Link from "next/link";
import { useState } from "react";
import type { SupplierLocation } from "@/db/schema";
import {
  useSupplier,
  useSupplierLocationsBySupplier,
  useCreateSupplierLocation,
  useUpdateSupplierLocation,
  useDeleteSupplierLocation,
} from "@/hooks/use-suppliers";
import { ServerError } from "@/components/forms";
import { Button } from "@/components/ui";
import { CertificationFieldTag } from "@/components/ui/certification-field-tag";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { SupplierLocationForm } from "./supplier-location-form";
import type { SupplierLocationFormData } from "@/schemas/suppliers";
import { resolveSupplierLocationDisplay } from "@/lib/supplier-location-display";

interface SupplierDetailProps {
  supplierId: string;
}

export function SupplierDetail({ supplierId }: SupplierDetailProps) {
  const [isAddingLocation, setIsAddingLocation] = useState(false);
  const [editingLocation, setEditingLocation] = useState<SupplierLocation | null>(null);
  const [deletingLocationId, setDeletingLocationId] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const { data: supplier, isLoading: supplierLoading, error: supplierError } = useSupplier(supplierId);
  const { data: locations = [], isLoading: locationsLoading } = useSupplierLocationsBySupplier(supplierId);
  const createLocation = useCreateSupplierLocation();
  const updateLocation = useUpdateSupplierLocation(supplierId);
  const deleteLocation = useDeleteSupplierLocation(supplierId);

  const handleCreateLocation = async (data: SupplierLocationFormData) => {
    setCreateError(null);
    try {
      await createLocation.mutateAsync({
        supplierId,
        ...data,
      });
      setIsAddingLocation(false);
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : "Failed to create location"
      );
    }
  };

  const handleUpdateLocation = async (data: SupplierLocationFormData) => {
    if (!editingLocation) return;

    setUpdateError(null);
    try {
      await updateLocation.mutateAsync({
        locationId: editingLocation.id,
        ...data,
      });
      setEditingLocation(null);
    } catch (error) {
      setUpdateError(
        error instanceof Error ? error.message : "Failed to update location"
      );
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deletingLocationId) return;
    setDeleteError(null);
    try {
      await deleteLocation.mutateAsync(deletingLocationId);
      setDeletingLocationId(null);
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : "Failed to delete location"
      );
    }
  };

  const isLoading = supplierLoading || locationsLoading;

  if (isLoading) {
    return <div className="body-large">Loading supplier details...</div>;
  }

  if (supplierError || !supplier) {
    return (
      <div className="p-32 border border-[var(--color-signal-red)] bg-[var(--color-signal-red)]/10">
        <p className="body-medium text-[var(--color-signal-red)]">
          {supplierError instanceof Error ? supplierError.message : "Failed to load supplier"}
        </p>
      </div>
    );
  }

  return (
    <div className="container-max page-shell">
      {/* Breadcrumb */}
      <div className="flex items-center gap-16 text-[var(--text-s)]">
        <Link
          href="/suppliers"
          className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
        >
          Suppliers
        </Link>
        <span className="text-[var(--color-text-tertiary)]">/</span>
        <span className="text-[var(--color-text-primary)]">{supplier.code}</span>
      </div>

      {/* Supplier Header */}
      <div className="p-32 border border-[var(--color-border-primary)] bg-[var(--color-background-white)]">
        <div className="flex items-start justify-between gap-24">
          <div>
            <h1 className="title-heading-2">{supplier.name}</h1>
            <p className="body-medium text-[var(--color-text-secondary)] mt-16">
              {supplier.code}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-32 mt-32 pt-32 border-t border-[var(--color-border-secondary)]">
          <div>
            <dt className="text-[var(--text-s)] font-medium text-[var(--color-text-secondary)] uppercase tracking-wide">
              Contact email
            </dt>
            <dd className="body-medium mt-16">{supplier.contactEmail || "—"}</dd>
          </div>
          <div>
            <dt className="text-[var(--text-s)] font-medium text-[var(--color-text-secondary)] uppercase tracking-wide">
              Contact phone
            </dt>
            <dd className="body-medium mt-16">{supplier.contactPhone || "—"}</dd>
          </div>
          <div>
            <dt className="text-[var(--text-s)] font-medium text-[var(--color-text-secondary)] uppercase tracking-wide">
              Location
            </dt>
            <dd className="body-medium mt-16">
              {resolveSupplierLocationDisplay(supplier.location, locations) || "—"}
            </dd>
          </div>
          <div>
            <dt className="flex items-center gap-6 text-[var(--text-s)] font-medium text-[var(--color-text-secondary)] uppercase tracking-wide">
              Distance to facility
              <CertificationFieldTag />
            </dt>
            <dd className="body-medium mt-16">
              {supplier.distanceToFacilityKm != null
                ? `${supplier.distanceToFacilityKm} km`
                : "—"}
            </dd>
          </div>
        </div>
      </div>

      {/* Locations Section */}
      <div className="flex flex-col gap-24">
        <div className="flex items-center justify-between">
          <h2 className="title-heading-3">
            Locations ({locations.length})
          </h2>
          {!isAddingLocation && !editingLocation && (
            <Button
              size="large"
              variant="primary"
              onClick={() => setIsAddingLocation(true)}
            >
              Add Location
            </Button>
          )}
        </div>

        {/* Add Location Form */}
        {isAddingLocation && (
          <div className="p-32 border border-[var(--color-border-primary)] bg-[var(--color-background-white)]">
            <h3 className="title-heading-4 mb-24">Add New Location</h3>
            <SupplierLocationForm
              onSubmit={handleCreateLocation}
              onCancel={() => {
                setIsAddingLocation(false);
                setCreateError(null);
              }}
              isSubmitting={createLocation.isPending}
              errorMessage={createError ?? undefined}
              submitLabel="Add Location"
            />
          </div>
        )}

        {/* Edit Location Form */}
        {editingLocation && (
          <div className="p-32 border border-[var(--color-border-primary)] bg-[var(--color-background-white)]">
            <h3 className="title-heading-4 mb-24">Edit Location</h3>
            <SupplierLocationForm
              location={editingLocation}
              onSubmit={handleUpdateLocation}
              onCancel={() => {
                setEditingLocation(null);
                setUpdateError(null);
              }}
              isSubmitting={updateLocation.isPending}
              errorMessage={updateError ?? undefined}
              submitLabel="Save Changes"
            />
          </div>
        )}

        {/* Locations List */}
        {locations.length === 0 ? (
          <div className="p-48 border border-[var(--color-border-tertiary)] bg-[var(--color-surface-light)] flex flex-col items-center justify-center gap-24 text-center">
            <div className="flex flex-col gap-16">
              <h3 className="title-heading-4">No locations yet</h3>
              <p className="body-medium text-[var(--color-text-secondary)]">
                Add locations to track where this supplier operates or collects feedstock.
              </p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-[var(--color-border-primary)]">
                  <th className="px-16 py-12 text-left text-[var(--text-s)] font-medium text-[var(--color-text-secondary)] uppercase tracking-wide">
                    Name
                  </th>
                  <th className="px-16 py-12 text-left text-[var(--text-s)] font-medium text-[var(--color-text-secondary)] uppercase tracking-wide">
                    Country
                  </th>
                  <th className="px-16 py-12 text-left text-[var(--text-s)] font-medium text-[var(--color-text-secondary)] uppercase tracking-wide">
                    State / Region
                  </th>
                  <th className="px-16 py-12 text-left text-[var(--text-s)] font-medium text-[var(--color-text-secondary)] uppercase tracking-wide">
                    City
                  </th>
                  <th className="px-16 py-12 text-left text-[var(--text-s)] font-medium text-[var(--color-text-secondary)] uppercase tracking-wide">
                    Address / Description
                  </th>
                  <th className="px-16 py-12 text-left text-[var(--text-s)] font-medium text-[var(--color-text-secondary)] uppercase tracking-wide">
                    Source location position
                  </th>
                  <th className="px-16 py-12 text-left">
                    <span className="flex items-center gap-6 text-[var(--text-s)] font-medium text-[var(--color-text-secondary)] uppercase tracking-wide">
                      One-way distance to facility (per leg, km)
                      <CertificationFieldTag />
                    </span>
                  </th>
                  <th className="px-16 py-12 text-left text-[var(--text-s)] font-medium text-[var(--color-text-secondary)] uppercase tracking-wide">
                    Default source location
                  </th>
                  <th className="px-16 py-12 text-right text-[var(--text-s)] font-medium text-[var(--color-text-secondary)] uppercase tracking-wide">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {locations.map((location) => (
                  <tr
                    key={location.id}
                    className="border-b border-[var(--color-border-tertiary)] hover:bg-[var(--color-surface-light)]"
                  >
                    <td className="px-16 py-12 body-medium">
                      {location.name || "—"}
                    </td>
                    <td className="px-16 py-12 body-medium">
                      {location.country}
                    </td>
                    <td className="px-16 py-12 body-medium text-[var(--color-text-secondary)]">
                      {location.stateRegion || "—"}
                    </td>
                    <td className="px-16 py-12 body-medium text-[var(--color-text-secondary)]">
                      {location.city || "—"}
                    </td>
                    <td className="px-16 py-12 body-medium text-[var(--color-text-secondary)]">
                      {location.address || "—"}
                    </td>
                    <td className="px-16 py-12 body-medium font-mono text-[var(--text-s)]">
                      {location.gpsLatitude !== null && location.gpsLongitude !== null
                        ? `${location.gpsLatitude.toFixed(4)}, ${location.gpsLongitude.toFixed(4)}`
                        : "—"}
                    </td>
                    <td className="px-16 py-12 body-medium">
                      {location.distanceFromFacilityKm != null
                        ? `${location.distanceFromFacilityKm} km`
                        : "—"}
                    </td>
                    <td className="px-16 py-12 body-medium">
                      {location.isDefault ? "Yes" : "No"}
                    </td>
                    <td className="px-16 py-12 text-right">
                      <div className="flex items-center justify-end gap-16">
                        <Button
                          variant="default"
                          size="small"
                          onClick={() => setEditingLocation(location)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="destructive"
                          size="small"
                          onClick={() => setDeletingLocationId(location.id)}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {deleteError && <ServerError message={deleteError} />}

      <DeleteConfirmDialog
        isOpen={!!deletingLocationId}
        title="Delete Location"
        message="Are you sure you want to delete this location? This action cannot be undone."
        onConfirm={handleDeleteConfirm}
        onCancel={() => {
          setDeletingLocationId(null);
          setDeleteError(null);
        }}
        isPending={deleteLocation.isPending}
      />
    </div>
  );
}
