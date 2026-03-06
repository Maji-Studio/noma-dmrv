/**
 * Customer Location Quick Add Dialog
 * Dialog for quickly adding new customer locations from the customer edit form.
 * Uses native <dialog> with showModal() — same pattern as operator/driver quick-add dialogs.
 */
"use client";

import { useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { X } from "@phosphor-icons/react";
import { useDialog } from "@/hooks/use-dialog";
import { useCreateCustomerLocation } from "@/hooks/use-customers";

// ============================================
// Types
// ============================================

interface CustomerLocationQuickAddDialogProps {
  isOpen: boolean;
  onClose: () => void;
  customerId: string;
}

// ============================================
// Component
// ============================================

export function CustomerLocationQuickAddDialog({
  isOpen,
  onClose,
  customerId,
}: CustomerLocationQuickAddDialogProps) {
  const [formData, setFormData] = useState({
    name: "",
    address: "",
    gpsLatitude: "",
    gpsLongitude: "",
  });
  const [error, setError] = useState<string | null>(null);
  const createLocation = useCreateCustomerLocation();

  const resetForm = useCallback(() => {
    setFormData({ name: "", address: "", gpsLatitude: "", gpsLongitude: "" });
    setError(null);
  }, []);

  const dialogRef = useDialog(isOpen, onClose, resetForm);

  const handleSubmit = async () => {
    setError(null);

    if (!formData.name.trim()) {
      setError("Location name is required");
      return;
    }

    if (!formData.address.trim()) {
      setError("Location is required");
      return;
    }

    const lat =
      formData.gpsLatitude.trim() === ""
        ? null
        : Number(formData.gpsLatitude);
    const lng =
      formData.gpsLongitude.trim() === ""
        ? null
        : Number(formData.gpsLongitude);

    if (lat !== null && (Number.isNaN(lat) || lat < -90 || lat > 90)) {
      setError("Latitude must be a number between -90 and 90");
      return;
    }

    if (lng !== null && (Number.isNaN(lng) || lng < -180 || lng > 180)) {
      setError("Longitude must be a number between -180 and 180");
      return;
    }

    try {
      await createLocation.mutateAsync({
        customerId,
        name: formData.name.trim(),
        address: formData.address.trim(),
        gpsLatitude: lat,
        gpsLongitude: lng,
      });
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create location"
      );
    }
  };

  if (!isOpen) return null;

  const inputClass =
    "flex h-40 w-full border border-[var(--color-border-primary)] bg-[var(--color-background-white)] px-12 text-[var(--color-text-primary)] text-[var(--text-s)] transition-colors placeholder:text-[var(--color-text-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]";

  return createPortal(
    <dialog
      ref={dialogRef}
      className="p-0 border border-[var(--color-border-primary)] backdrop:bg-black/50 max-w-lg w-full m-auto"
      data-testid="location-quick-add-dialog"
      aria-labelledby="location-quick-add-dialog-title"
    >
      <div className="flex flex-col">
        <div className="flex items-center justify-between p-24 border-b border-[var(--color-border-primary)]">
          <h2
            id="location-quick-add-dialog-title"
            className="title-heading-3"
          >
            Add Location
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-4 rounded-4 hover:bg-[var(--color-background-medium)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
            aria-label="Close dialog"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex flex-col gap-24 p-24" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSubmit(); } }}>
          {error && (
            <div
              role="alert"
              className="px-12 py-8 bg-[var(--color-signal-red-light)] text-[var(--color-signal-red)] text-[var(--text-s)]"
            >
              {error}
            </div>
          )}

          <div className="flex flex-col gap-16">
            <label htmlFor="location-name" className="label-medium">
              Name <span className="text-[var(--color-signal-red)]">*</span>
            </label>
            <input
              id="location-name"
              type="text"
              value={formData.name}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, name: e.target.value }))
              }
              placeholder="e.g., Demonstration Plot A"
              className={inputClass}
              data-testid="location-name-input"
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-16">
            <label htmlFor="location-address" className="label-medium">
              Location{" "}
              <span className="text-[var(--color-signal-red)]">*</span>
            </label>
            <input
              id="location-address"
              type="text"
              value={formData.address}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, address: e.target.value }))
              }
              placeholder="e.g., Moshi Rural District, Kilimanjaro Region"
              className={inputClass}
              data-testid="location-address-input"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-24">
            <div className="flex flex-col gap-16">
              <label htmlFor="location-latitude" className="label-medium">
                GPS Latitude
              </label>
              <input
                id="location-latitude"
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
                className={inputClass}
                data-testid="location-latitude-input"
              />
            </div>

            <div className="flex flex-col gap-16">
              <label htmlFor="location-longitude" className="label-medium">
                GPS Longitude
              </label>
              <input
                id="location-longitude"
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
                className={inputClass}
                data-testid="location-longitude-input"
              />
            </div>
          </div>

          <div className="flex gap-16 justify-end pt-16">
            <button
              type="button"
              onClick={onClose}
              disabled={createLocation.isPending}
              className="h-40 px-12 border border-[var(--color-border-primary)] rounded-none hover:bg-[var(--color-background-medium)] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={createLocation.isPending}
              className="flex items-center gap-8 px-16 py-8 bg-[var(--color-interaction)] text-white rounded-none hover:opacity-90 disabled:opacity-50"
              data-testid="location-submit-button"
            >
              {createLocation.isPending ? "Adding..." : "Add Location"}
            </button>
          </div>
        </div>
      </div>
    </dialog>,
    document.body
  );
}
