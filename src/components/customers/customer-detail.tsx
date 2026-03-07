/**
 * CustomerDetail component
 * Customer detail view with nested locations management
 * Includes inline create/edit forms for locations and delete confirmation
 */
"use client";

import Link from "next/link";
import { useState } from "react";
import type { CustomerLocation } from "@/db/schema";
import {
  useCustomerWithRelations,
  useCreateCustomerLocation,
  useUpdateCustomerLocation,
  useDeleteCustomerLocation,
} from "@/hooks/use-customers";
import { ServerError } from "@/components/forms";
import { Button } from "@/components/ui";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { CustomerLocationForm } from "./customer-location-form";
import type { CustomerLocationFormData } from "@/schemas/customers";

interface CustomerDetailProps {
  customerId: string;
}

export function CustomerDetail({ customerId }: CustomerDetailProps) {
  const [isAddingLocation, setIsAddingLocation] = useState(false);
  const [editingLocation, setEditingLocation] = useState<{
    id: string;
    name: string;
    gpsLatitude: number | null;
    gpsLongitude: number | null;
    address: string | null;
  } | null>(null);
  const [deletingLocationId, setDeletingLocationId] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const { data: customer, isLoading, error } = useCustomerWithRelations(customerId);
  const createLocation = useCreateCustomerLocation();
  const updateLocation = useUpdateCustomerLocation();
  const deleteLocation = useDeleteCustomerLocation(customerId);

  const handleCreateLocation = async (data: CustomerLocationFormData) => {
    setCreateError(null);
    try {
      await createLocation.mutateAsync({
        customerId,
        name: data.name,
        gpsLatitude: data.gpsLatitude,
        gpsLongitude: data.gpsLongitude,
        address: data.address || "",
      });
      setIsAddingLocation(false);
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : "Failed to create location"
      );
    }
  };

  const handleUpdateLocation = async (data: CustomerLocationFormData) => {
    if (!editingLocation) return;

    setUpdateError(null);
    try {
      await updateLocation.mutateAsync({
        locationId: editingLocation.id,
        name: data.name,
        gpsLatitude: data.gpsLatitude,
        gpsLongitude: data.gpsLongitude,
        address: data.address,
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

  if (isLoading) {
    return <div className="body-large">Loading customer details...</div>;
  }

  if (error || !customer) {
    return (
      <div className="p-32 border border-[var(--color-signal-red)] bg-[var(--color-signal-red)]/10">
        <p className="body-medium text-[var(--color-signal-red)]">
          {error instanceof Error ? error.message : "Failed to load customer"}
        </p>
      </div>
    );
  }

  return (
    <div className="container-max py-32 flex flex-col gap-32">
      {/* Breadcrumb */}
      <div className="flex items-center gap-16 text-[var(--text-s)]">
        <Link
          href="/customers"
          className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
        >
          Customers
        </Link>
        <span className="text-[var(--color-text-tertiary)]">/</span>
        <span className="text-[var(--color-text-primary)]">{customer.code}</span>
      </div>

      {/* Customer Header */}
      <div className="p-32 border border-[var(--color-border-primary)] bg-[var(--color-background-white)]">
        <div className="flex items-start justify-between gap-24">
          <div>
            <h1 className="title-heading-2">{customer.name}</h1>
            <p className="body-medium text-[var(--color-text-secondary)] mt-16">
              {customer.code}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-32 mt-32 pt-32 border-t border-[var(--color-border-secondary)]">
          <div>
            <dt className="text-[var(--text-s)] font-medium text-[var(--color-text-secondary)] uppercase tracking-wide">
              Crop Type
            </dt>
            <dd className="body-medium mt-16">{customer.cropType || "—"}</dd>
          </div>
          <div>
            <dt className="text-[var(--text-s)] font-medium text-[var(--color-text-secondary)] uppercase tracking-wide">
              Contact Email
            </dt>
            <dd className="body-medium mt-16">{customer.contactEmail || "—"}</dd>
          </div>
          <div>
            <dt className="text-[var(--text-s)] font-medium text-[var(--color-text-secondary)] uppercase tracking-wide">
              Contact Phone
            </dt>
            <dd className="body-medium mt-16">{customer.contactPhone || "—"}</dd>
          </div>
          {customer.address && (
            <div className="md:col-span-3">
              <dt className="text-[var(--text-s)] font-medium text-[var(--color-text-secondary)] uppercase tracking-wide">
                Address
              </dt>
              <dd className="body-medium mt-16 whitespace-pre-line">
                {customer.address}
              </dd>
            </div>
          )}
        </div>
      </div>

      {/* Locations Section */}
      <div className="flex flex-col gap-24">
        <div className="flex items-center justify-between">
          <h2 className="title-heading-3">
            Locations ({customer.locations.length})
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
            {createError && <ServerError message={createError} />}
            <CustomerLocationForm
              onSubmit={handleCreateLocation}
              onCancel={() => {
                setIsAddingLocation(false);
                setCreateError(null);
              }}
              isSubmitting={createLocation.isPending}
              submitLabel="Add Location"
            />
          </div>
        )}

        {/* Edit Location Form */}
        {editingLocation && (
          <div className="p-32 border border-[var(--color-border-primary)] bg-[var(--color-background-white)]">
            <h3 className="title-heading-4 mb-24">Edit Location</h3>
            {updateError && <ServerError message={updateError} />}
            <CustomerLocationForm
              location={editingLocation as CustomerLocation}
              onSubmit={handleUpdateLocation}
              onCancel={() => {
                setEditingLocation(null);
                setUpdateError(null);
              }}
              isSubmitting={updateLocation.isPending}
              submitLabel="Save Changes"
            />
          </div>
        )}

        {/* Locations List */}
        {customer.locations.length === 0 ? (
          <div className="p-48 border border-[var(--color-border-tertiary)] bg-[var(--color-surface-light)] flex flex-col items-center justify-center gap-24 text-center">
            <div className="flex flex-col gap-16">
              <h3 className="title-heading-4">No locations yet</h3>
              <p className="body-medium text-[var(--color-text-secondary)]">
                Add locations to track where this customer receives deliveries.
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
                    Latitude
                  </th>
                  <th className="px-16 py-12 text-left text-[var(--text-s)] font-medium text-[var(--color-text-secondary)] uppercase tracking-wide">
                    Longitude
                  </th>
                  <th className="px-16 py-12 text-left text-[var(--text-s)] font-medium text-[var(--color-text-secondary)] uppercase tracking-wide">
                    Location
                  </th>
                  <th className="px-16 py-12 text-right text-[var(--text-s)] font-medium text-[var(--color-text-secondary)] uppercase tracking-wide">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {customer.locations.map((location) => (
                  <tr
                    key={location.id}
                    className="border-b border-[var(--color-border-tertiary)] hover:bg-[var(--color-surface-light)]"
                  >
                    <td className="px-16 py-12 body-medium">{location.name}</td>
                    <td className="px-16 py-12 body-medium font-mono text-[var(--text-s)]">
                      {location.gpsLatitude !== null
                        ? location.gpsLatitude.toFixed(6)
                        : "—"}
                    </td>
                    <td className="px-16 py-12 body-medium font-mono text-[var(--text-s)]">
                      {location.gpsLongitude !== null
                        ? location.gpsLongitude.toFixed(6)
                        : "—"}
                    </td>
                    <td className="px-16 py-12 body-medium text-[var(--color-text-secondary)]">
                      {location.address || "—"}
                    </td>
                    <td className="px-16 py-12 text-right">
                      <div className="flex items-center justify-end gap-16">
                        <button
                          type="button"
                          onClick={() => setEditingLocation(location)}
                          className="h-[32px] px-12 border border-[var(--color-border-primary)] rounded-none hover:bg-[var(--color-background-medium)] body-small"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeletingLocationId(location.id)}
                          className="h-[32px] px-12 border border-[var(--color-signal-red)] text-[var(--color-signal-red)] rounded-none hover:bg-[var(--color-signal-red)]/10 body-small"
                        >
                          Delete
                        </button>
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
