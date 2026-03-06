/**
 * Customer Location Quick Add Dialog
 * Inline dialog for quickly adding new customer locations from the customer edit form.
 */
"use client";

import { useState } from "react";
import { useDialog } from "@/hooks/use-dialog";
import { cn } from "@/lib/utils";
import { useCreateCustomerLocation } from "@/hooks/use-customers";

// ============================================
// Icon components
// ============================================

function XIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M15 5L5 15M5 5l10 10"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn("animate-spin", className)}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle
        cx="8"
        cy="8"
        r="6"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="2"
      />
      <path
        d="M8 2a6 6 0 0 1 6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

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
  if (!isOpen) return null;

  return (
    <CustomerLocationQuickAddDialogInner
      isOpen={isOpen}
      onClose={onClose}
      customerId={customerId}
    />
  );
}

function CustomerLocationQuickAddDialogInner({
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
  const dialogRef = useDialog(isOpen, onClose);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
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

  const inputClass =
    "flex h-40 w-full border border-[var(--color-border-primary)] bg-[var(--color-background-white)] px-12 text-[var(--color-text-primary)] text-[var(--text-s)] transition-colors placeholder:text-[var(--color-text-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]";

  return (
    <dialog
      ref={dialogRef}
      className="w-full max-w-lg p-0 rounded-[var(--radius-8)] border border-[var(--color-border-primary)] backdrop:bg-black/50"
      data-testid="location-quick-add-dialog"
      aria-labelledby="location-quick-add-dialog-title"
    >
      <div className="flex flex-col bg-[var(--color-background-white)]">
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
            <XIcon className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-24 p-24">
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
              Location <span className="text-[var(--color-signal-red)]">*</span>
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
              type="submit"
              disabled={createLocation.isPending}
              className="flex items-center gap-8 px-16 py-8 bg-[var(--color-interaction)] text-white rounded-none hover:opacity-90 disabled:opacity-50"
              data-testid="location-submit-button"
            >
              {createLocation.isPending && (
                <SpinnerIcon className="w-4 h-4" />
              )}
              {createLocation.isPending ? "Adding..." : "Add Location"}
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}
