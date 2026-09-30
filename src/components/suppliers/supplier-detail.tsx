/**
 * SupplierDetail component
 * Supplier detail view with nested locations management
 * Includes create/edit dialogs for locations and delete confirmation
 */
"use client";

import Link from "next/link";
import { useState } from "react";
import type { SupplierLocation } from "@/db/schema";
import {
  useSupplier,
  useSupplierLocationsBySupplier,
  useDeleteSupplierLocation,
} from "@/hooks/use-suppliers";
import { ServerError } from "@/components/forms";
import { Button } from "@/components/ui";
import { CertificationFieldTag } from "@/components/ui/certification-field-tag";
import {
  resolveDetailFieldValue,
  type DetailPanelField,
} from "@/components/ui/detail-panel";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { TableSkeleton } from "@/components/ui/loading-skeleton";
import { SupplierLocationDialog } from "./supplier-location-dialog";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { cn } from "@/lib/utils";
import {
  buildSupplierFallbackDistanceField,
  buildSupplierLocationField,
} from "./supplier-detail-fields";
import { Notice } from "@/components/ui/notice";
import { EmptyState } from "@/components/ui/empty-state";
import { MapPinIcon } from "@phosphor-icons/react/dist/ssr";

interface SupplierDetailProps {
  supplierId: string;
}

/** Columns in the supplier locations table, so its loading skeleton matches. */
const LOCATION_TABLE_COLUMNS = 5;

const LOCATION_HEAD_TEXT =
  "text-[var(--text-s)] font-medium text-[var(--color-text-secondary)] uppercase tracking-wide";
const LOCATION_HEAD_CLASS = cn("px-16 py-12 text-left", LOCATION_HEAD_TEXT);

/** City, region and country as one line; missing parts are skipped. */
function formatLocationPlace(location: SupplierLocation): string {
  return [location.city, location.stateRegion, location.country]
    .filter(Boolean)
    .join(", ");
}

/**
 * One field of the supplier header summary.
 *
 * The header keeps its own `<dt>/<dd>` markup for the summary grid, but the
 * value runs through the whole shared `DetailField` contract: a pending field
 * shows the skeleton, and a settled empty one takes the same placeholder ink,
 * weight, and `data-empty` hook as every other detail surface.
 */
export function SupplierSummaryField({ field }: { field: DetailPanelField }) {
  const { displayValue, isEmpty, valueClassName } =
    resolveDetailFieldValue(field);

  return (
    <div>
      <dt className="flex items-center gap-6 text-[var(--text-s)] font-medium text-[var(--color-text-secondary)] uppercase tracking-wide">
        {field.label}
        {field.certifyRequired && (
          <CertificationFieldTag status={field.certifyStatus} />
        )}
      </dt>
      <dd
        className={cn("body-medium mt-16", valueClassName)}
        aria-busy={field.pending || undefined}
        data-empty={isEmpty || undefined}
        data-pending={field.pending || undefined}
      >
        {displayValue}
      </dd>
    </div>
  );
}

export function SupplierDetail({ supplierId }: SupplierDetailProps) {
  const [isLocationDialogOpen, setIsLocationDialogOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<SupplierLocation>();
  const [deletingLocationId, setDeletingLocationId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const { data: supplier, isLoading: supplierLoading, error: supplierError } = useSupplier(supplierId);
  const { data: locations = [], isLoading: locationsLoading } = useSupplierLocationsBySupplier(supplierId);
  const deleteLocation = useDeleteSupplierLocation(supplierId);

  const handleDeleteConfirm = async () => {
    if (!deletingLocationId) return;
    setDeleteError(null);
    try {
      await deleteLocation.mutateAsync(deletingLocationId);
      setDeletingLocationId(null);
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : "Location was not deleted. Try again."
      );
    }
  };

  if (supplierLoading) {
    return <div className="body-large">Loading supplier details...</div>;
  }

  if (supplierError || !supplier) {
    return (
      <Notice tone="error">
        {supplierError instanceof Error ? supplierError.message : "The supplier could not be loaded. Refresh the page and try again."}
      </Notice>
    );
  }

  const fallbackDistanceField = buildSupplierFallbackDistanceField({
    defaultLocationDistanceKm:
      locations.find((location) => location.isDefault)?.distanceFromFacilityKm ??
      null,
    legacySupplierDistanceKm: supplier.distanceToFacilityKm,
    locationsLoaded: !locationsLoading,
  });
  const locationField = buildSupplierLocationField({
    legacySupplierLocation: supplier.location,
    locations,
    locationsLoaded: !locationsLoading,
  });

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
          <SupplierSummaryField
            field={{ label: "Contact email", value: supplier.contactEmail }}
          />
          <SupplierSummaryField
            field={{ label: "Contact phone", value: supplier.contactPhone }}
          />
          <SupplierSummaryField field={locationField} />
          <SupplierSummaryField field={fallbackDistanceField} />
        </div>
      </div>

      {/* Locations Section */}
      <div className="flex flex-col gap-24">
        <div className="flex items-center justify-between">
          <h2 className="title-heading-3">
            {locationsLoading ? "Locations" : `Locations (${locations.length})`}
          </h2>
          {!isLocationDialogOpen && (
            <Button
              size="large"
              variant="primary"
              onClick={() => {
                setEditingLocation(undefined);
                setIsLocationDialogOpen(true);
              }}
            >
              Add location
            </Button>
          )}
        </div>

        {/* Locations List */}
        {locationsLoading ? (
          <TableSkeleton columns={LOCATION_TABLE_COLUMNS} rows={3} />
        ) : locations.length === 0 ? (
          <EmptyState
            icon={<MapPinIcon size={40} />}
            title="No locations yet"
            description="Add locations to track where this supplier operates or collects feedstock."
            padding="md"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-[var(--color-border-primary)]">
                  <th className={LOCATION_HEAD_CLASS}>Name</th>
                  <th className={LOCATION_HEAD_CLASS}>Place</th>
                  <th className={LOCATION_HEAD_CLASS}>Source location position</th>
                  <th className="px-16 py-12 text-left">
                    <span className={cn("flex items-center gap-6", LOCATION_HEAD_TEXT)}>
                      Distance to facility
                      <CertificationFieldTag />
                    </span>
                  </th>
                  <th className={cn("px-16 py-12 text-right", LOCATION_HEAD_TEXT)}>
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
                      <span className="flex flex-wrap items-center gap-x-8">
                        {location.name || MISSING_VALUE.notRecorded}
                        {location.isDefault && (
                          <span className="body-caption text-[var(--color-text-tertiary)]">
                            Default source location
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-16 py-12 body-medium text-[var(--color-text-secondary)]">
                      {formatLocationPlace(location)}
                      <span className="block body-caption text-[var(--color-text-tertiary)]">
                        {location.address || MISSING_VALUE.notRecorded}
                      </span>
                    </td>
                    <td className="px-16 py-12 body-medium font-mono text-[var(--text-s)]">
                      {location.gpsLatitude !== null && location.gpsLongitude !== null
                        ? `${location.gpsLatitude.toFixed(4)}, ${location.gpsLongitude.toFixed(4)}`
                        : MISSING_VALUE.notSet}
                    </td>
                    <td className="px-16 py-12 body-medium">
                      {location.distanceFromFacilityKm != null
                        ? `${location.distanceFromFacilityKm} km`
                        : MISSING_VALUE.notSet}
                    </td>
                    <td className="px-16 py-12 text-right">
                      <div className="flex items-center justify-end gap-16">
                        <Button
                          variant="default"
                          size="small"
                          onClick={() => {
                            setEditingLocation(location);
                            setIsLocationDialogOpen(true);
                          }}
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

      <SupplierLocationDialog
        isOpen={isLocationDialogOpen}
        onClose={() => setIsLocationDialogOpen(false)}
        supplierId={supplierId}
        location={editingLocation}
      />

      <DeleteConfirmDialog
        isOpen={!!deletingLocationId}
        title="Delete location"
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
