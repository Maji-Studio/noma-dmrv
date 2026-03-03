/**
 * Vehicle Quick Add Dialog
 * Inline dialog for quickly adding new vehicles from EntitySelect dropdown
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { createVehicleFn } from "@/fn/quick-add";
import type { EntityOption } from "./types";

// Icon components
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

interface VehicleQuickAddDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (entity: EntityOption) => void;
}

interface VehicleForm {
  name: string;
  identifier: string;
  vehicleType: string;
  fuelType: string;
  fuelConsumptionLPerKm: string;
  modelYear: string;
}

const VEHICLE_TYPES = ["truck", "tractor", "van", "pickup", "trailer"];
const FUEL_TYPES = ["Diesel", "Gasoline", "Electric", "Hybrid", "Biodiesel"];

export function VehicleQuickAddDialog({
  isOpen,
  onClose,
  onSuccess,
}: VehicleQuickAddDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [formData, setFormData] = useState<VehicleForm>({
    name: "",
    identifier: "",
    vehicleType: "",
    fuelType: "",
    fuelConsumptionLPerKm: "",
    modelYear: new Date().getFullYear().toString(),
  });
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const resetForm = () => {
    setFormData({
      name: "",
      identifier: "",
      vehicleType: "",
      fuelType: "",
      fuelConsumptionLPerKm: "",
      modelYear: new Date().getFullYear().toString(),
    });
    setError(null);
    setIsSubmitting(false);
  };

  // Handle dialog open/close with native dialog API
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      resetForm();
      dialog.showModal();
    } else {
      dialog.close();
    }
  }, [isOpen]);

  // Handle ESC key
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };

    dialog.addEventListener("cancel", handleCancel);
    return () => dialog.removeEventListener("cancel", handleCancel);
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    // Validate required fields
    if (!formData.name.trim()) {
      setError("Name is required");
      setIsSubmitting(false);
      return;
    }
    if (!formData.identifier.trim()) {
      setError("Identifier is required");
      setIsSubmitting(false);
      return;
    }
    if (!formData.vehicleType) {
      setError("Vehicle type is required");
      setIsSubmitting(false);
      return;
    }
    if (!formData.fuelType) {
      setError("Fuel type is required");
      setIsSubmitting(false);
      return;
    }

    // Parse numeric fields
    const fuelConsumption = parseFloat(formData.fuelConsumptionLPerKm);
    const modelYear = parseInt(formData.modelYear, 10);

    if (isNaN(fuelConsumption) || fuelConsumption <= 0) {
      setError("Please enter a valid fuel consumption value");
      setIsSubmitting(false);
      return;
    }

    if (isNaN(modelYear) || modelYear < 1900) {
      setError("Please enter a valid model year");
      setIsSubmitting(false);
      return;
    }

    try {
      const result = await createVehicleFn({
        name: formData.name.trim(),
        identifier: formData.identifier.trim(),
        vehicleType: formData.vehicleType,
        fuelType: formData.fuelType,
        fuelConsumptionLPerKm: fuelConsumption,
        modelYear,
      });

      if (!result.success) {
        setError(result.error);
        setIsSubmitting(false);
        return;
      }

      onSuccess(result.data);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create vehicle");
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <dialog
      ref={dialogRef}
      className="p-0 border border-[var(--color-border-primary)] backdrop:bg-black/50 max-w-lg w-full m-auto"
      aria-labelledby="vehicle-quick-add-dialog-title"
      data-testid="vehicle-quick-add-dialog"
    >
      <div className="flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-24 border-b border-[var(--color-border-primary)]">
          <h2 id="vehicle-quick-add-dialog-title" className="title-heading-3">
            Add New Vehicle
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

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-24 p-24">
          {error && (
            <div className="px-12 py-8 bg-[var(--color-signal-red-light)] text-[var(--color-signal-red)] text-[var(--text-s)] rounded-none">
              {error}
            </div>
          )}

          <div className="flex flex-col gap-16">
            <label htmlFor="vehicle-name" className="label-medium">
              Name <span className="text-[var(--color-signal-red)]">*</span>
            </label>
            <input
              id="vehicle-name"
              type="text"
              value={formData.name}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, name: e.target.value }))
              }
              placeholder="e.g., Truck 1"
              className="flex h-40 w-full border border-[var(--color-border-primary)] bg-[var(--color-background-white)] px-12 text-[var(--color-text-primary)] text-[var(--text-s)] transition-colors placeholder:text-[var(--color-text-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]"
              autoFocus
              data-testid="vehicle-name-input"
            />
          </div>

          <div className="flex flex-col gap-16">
            <label htmlFor="vehicle-identifier" className="label-medium">
              Identifier / Plate{" "}
              <span className="text-[var(--color-signal-red)]">*</span>
            </label>
            <input
              id="vehicle-identifier"
              type="text"
              value={formData.identifier}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, identifier: e.target.value }))
              }
              placeholder="e.g., T 123 ABC"
              className="flex h-40 w-full border border-[var(--color-border-primary)] bg-[var(--color-background-white)] px-12 text-[var(--color-text-primary)] text-[var(--text-s)] transition-colors placeholder:text-[var(--color-text-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]"
              data-testid="vehicle-identifier-input"
            />
          </div>

          <div className="grid grid-cols-2 gap-24">
            <div className="flex flex-col gap-16">
              <label htmlFor="vehicle-type" className="label-medium">
                Vehicle Type{" "}
                <span className="text-[var(--color-signal-red)]">*</span>
              </label>
              <select
                id="vehicle-type"
                value={formData.vehicleType}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, vehicleType: e.target.value }))
                }
                className="flex h-40 w-full border border-[var(--color-border-primary)] bg-[var(--color-background-white)] px-12 text-[var(--color-text-primary)] text-[var(--text-s)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]"
                data-testid="vehicle-type-select"
              >
                <option value="">Select type...</option>
                {VEHICLE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type.charAt(0).toUpperCase() + type.slice(1)}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-16">
              <label htmlFor="vehicle-fuel-type" className="label-medium">
                Fuel Type{" "}
                <span className="text-[var(--color-signal-red)]">*</span>
              </label>
              <select
                id="vehicle-fuel-type"
                value={formData.fuelType}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, fuelType: e.target.value }))
                }
                className="flex h-40 w-full border border-[var(--color-border-primary)] bg-[var(--color-background-white)] px-12 text-[var(--color-text-primary)] text-[var(--text-s)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]"
                data-testid="vehicle-fuel-type-select"
              >
                <option value="">Select fuel...</option>
                {FUEL_TYPES.map((fuel) => (
                  <option key={fuel} value={fuel}>
                    {fuel}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-24">
            <div className="flex flex-col gap-16">
              <label htmlFor="vehicle-consumption" className="label-medium">
                Fuel Consumption (L/km){" "}
                <span className="text-[var(--color-signal-red)]">*</span>
              </label>
              <input
                id="vehicle-consumption"
                type="number"
                step="0.01"
                min="0.01"
                max="10"
                value={formData.fuelConsumptionLPerKm}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    fuelConsumptionLPerKm: e.target.value,
                  }))
                }
                placeholder="e.g., 0.3"
                className="flex h-40 w-full border border-[var(--color-border-primary)] bg-[var(--color-background-white)] px-12 text-[var(--color-text-primary)] text-[var(--text-s)] transition-colors placeholder:text-[var(--color-text-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]"
                data-testid="vehicle-consumption-input"
              />
            </div>

            <div className="flex flex-col gap-16">
              <label htmlFor="vehicle-year" className="label-medium">
                Model Year{" "}
                <span className="text-[var(--color-signal-red)]">*</span>
              </label>
              <input
                id="vehicle-year"
                type="number"
                min="1900"
                max={new Date().getFullYear() + 1}
                value={formData.modelYear}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, modelYear: e.target.value }))
                }
                placeholder="e.g., 2020"
                className="flex h-40 w-full border border-[var(--color-border-primary)] bg-[var(--color-background-white)] px-12 text-[var(--color-text-primary)] text-[var(--text-s)] transition-colors placeholder:text-[var(--color-text-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]"
                data-testid="vehicle-year-input"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-16 justify-end pt-16">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="h-40 px-12 border border-[var(--color-border-primary)] rounded-none hover:bg-[var(--color-background-medium)] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-8 px-16 py-8 bg-[var(--color-interaction)] text-white rounded-none hover:opacity-90 disabled:opacity-50"
              data-testid="vehicle-submit-button"
            >
              {isSubmitting && <SpinnerIcon className="w-4 h-4" />}
              {isSubmitting ? "Creating..." : "Create Vehicle"}
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}
