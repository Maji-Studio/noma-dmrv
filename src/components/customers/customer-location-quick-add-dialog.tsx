/**
 * Customer Location Quick Add Dialog
 * Inline dialog for quickly adding new customer locations from the customer edit form.
 *
 * Uses a div-based overlay instead of native <dialog> to avoid focus-trapping
 * conflicts with the parent Base UI modal (EntitySideSheet / SlideOverPanel).
 */
"use client";

import { useEffect, useRef, useState } from "react";
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

  // Unmounts when isOpen becomes false, so inner state resets automatically
  return (
    <CustomerLocationQuickAddDialogInner
      onClose={onClose}
      customerId={customerId}
    />
  );
}

function CustomerLocationQuickAddDialogInner({
  onClose,
  customerId,
}: Omit<CustomerLocationQuickAddDialogProps, "isOpen">) {
  const nameRef = useRef<HTMLInputElement>(null);
  const [formData, setFormData] = useState({
    name: "",
    gpsLatitude: "",
    gpsLongitude: "",
    address: "",
  });
  const [error, setError] = useState<string | null>(null);
  const createLocation = useCreateCustomerLocation();

  // Focus the name input on mount
  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose]);

  const handleSubmit = async () => {
    setError(null);

    if (!formData.name.trim()) {
      setError("Location name is required");
      return;
    }

    const lat = parseFloat(formData.gpsLatitude);
    const lng = parseFloat(formData.gpsLongitude);

    if (isNaN(lat) || lat < -90 || lat > 90) {
      setError("Latitude must be a number between -90 and 90");
      return;
    }
    if (isNaN(lng) || lng < -180 || lng > 180) {
      setError("Longitude must be a number between -180 and 180");
      return;
    }

    try {
      await createLocation.mutateAsync({
        customerId,
        name: formData.name.trim(),
        gpsLatitude: lat,
        gpsLongitude: lng,
        address: formData.address.trim() || undefined,
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
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      data-testid="location-quick-add-dialog"
      role="dialog"
      aria-labelledby="location-quick-add-dialog-title"
      aria-modal="true"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-lg border border-[var(--color-border-primary)] bg-[var(--color-background-white)]">
        {/* Header */}
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
            className="p-4 hover:bg-[var(--color-background-medium)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
            aria-label="Close dialog"
          >
            <XIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Form body */}
        <div className="flex flex-col gap-24 p-24">
          {error && (
            <div className="px-12 py-8 bg-[var(--color-signal-red-light)] text-[var(--color-signal-red)] text-[var(--text-s)]">
              {error}
            </div>
          )}

          <div className="flex flex-col gap-16">
            <label htmlFor="location-name" className="label-medium">
              Name <span className="text-[var(--color-signal-red)]">*</span>
            </label>
            <input
              ref={nameRef}
              id="location-name"
              type="text"
              value={formData.name}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, name: e.target.value }))
              }
              placeholder="e.g., North Field"
              className={inputClass}
              data-testid="location-name-input"
            />
          </div>

          <div className="grid grid-cols-2 gap-24">
            <div className="flex flex-col gap-16">
              <label htmlFor="location-latitude" className="label-medium">
                GPS Latitude{" "}
                <span className="text-[var(--color-signal-red)]">*</span>
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
                placeholder="e.g., -1.2921"
                className={inputClass}
                data-testid="location-latitude-input"
              />
            </div>

            <div className="flex flex-col gap-16">
              <label htmlFor="location-longitude" className="label-medium">
                GPS Longitude{" "}
                <span className="text-[var(--color-signal-red)]">*</span>
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
                placeholder="e.g., 36.8219"
                className={inputClass}
                data-testid="location-longitude-input"
              />
            </div>
          </div>

          <div className="flex flex-col gap-16">
            <label htmlFor="location-address" className="label-medium">
              Address
            </label>
            <input
              id="location-address"
              type="text"
              value={formData.address}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, address: e.target.value }))
              }
              placeholder="e.g., Kiambu County, Kenya"
              className={inputClass}
              data-testid="location-address-input"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-16 justify-end pt-16">
            <button
              type="button"
              onClick={onClose}
              disabled={createLocation.isPending}
              className="h-40 px-12 border border-[var(--color-border-primary)] hover:bg-[var(--color-background-medium)] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={createLocation.isPending}
              className="flex items-center gap-8 px-16 py-8 bg-[var(--color-interaction)] text-white hover:opacity-90 disabled:opacity-50"
              data-testid="location-submit-button"
            >
              {createLocation.isPending && (
                <SpinnerIcon className="w-4 h-4" />
              )}
              {createLocation.isPending ? "Adding..." : "Add Location"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
