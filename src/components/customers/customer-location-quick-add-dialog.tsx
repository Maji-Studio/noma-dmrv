/**
 * Customer Location Quick Add Dialog
 * Dialog for quickly adding new customer locations from the customer edit form.
 * Composes the shared `Modal` primitive with an inset header.
 */
"use client";

import { useState, useCallback } from "react";
import { Modal } from "@/components/ui";
import { Button } from "@/components/ui/button";
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
    country: "",
    stateRegion: "",
    city: "",
    address: "",
    gpsLatitude: "",
    gpsLongitude: "",
  });
  const [error, setError] = useState<string | null>(null);
  const createLocation = useCreateCustomerLocation();

  const resetForm = useCallback(() => {
    setFormData({ name: "", country: "", stateRegion: "", city: "", address: "", gpsLatitude: "", gpsLongitude: "" });
    setError(null);
  }, []);

  const handleSubmit = async () => {
    setError(null);

    if (!formData.name.trim()) {
      setError("Location name is required");
      return;
    }

    if (!formData.country.trim()) {
      setError("Country is required");
      return;
    }

    // The server's createCustomerLocationSchema requires a non-empty address —
    // catch it here so the operator sees the gap before submitting.
    if (!formData.address.trim()) {
      setError("Address / description is required");
      return;
    }

    if (formData.gpsLatitude.trim() === "" || formData.gpsLongitude.trim() === "") {
      setError("GPS latitude and longitude are required");
      return;
    }

    const lat = Number(formData.gpsLatitude);
    const lng = Number(formData.gpsLongitude);

    if (Number.isNaN(lat) || lat < -90 || lat > 90) {
      setError("Latitude must be a number between -90 and 90");
      return;
    }

    if (Number.isNaN(lng) || lng < -180 || lng > 180) {
      setError("Longitude must be a number between -180 and 180");
      return;
    }

    try {
      await createLocation.mutateAsync({
        customerId,
        name: formData.name.trim(),
        country: formData.country.trim(),
        stateRegion: formData.stateRegion.trim() || null,
        city: formData.city.trim() || null,
        address: formData.address.trim(),
        gpsLatitude: lat,
        gpsLongitude: lng,
        isDefault: false,
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
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      onOpen={resetForm}
      ariaLabelledBy="location-quick-add-dialog-title"
      width="md"
      // Inset header has its own padding + bottom border that must reach the
      // dialog edges, so we opt out of Modal's default content padding.
      contentClassName=""
    >
      <div className="flex flex-col" data-testid="location-quick-add-dialog">
        <div className="flex items-center p-24 border-b border-[var(--color-border-primary)]">
          <h2
            id="location-quick-add-dialog-title"
            className="title-heading-3"
          >
            Add Location
          </h2>
        </div>

        <div className="flex flex-col gap-24 p-24" onKeyDown={(e) => { if (e.key === "Enter" && !createLocation.isPending && e.target instanceof HTMLInputElement) { e.preventDefault(); handleSubmit(); } }}>
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

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-24">
            <div className="flex flex-col gap-16">
              <label htmlFor="location-country" className="label-medium">
                Country{" "}
                <span className="text-[var(--color-signal-red)]">*</span>
              </label>
              <input
                id="location-country"
                type="text"
                value={formData.country}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, country: e.target.value }))
                }
                placeholder="e.g., Tanzania"
                className={inputClass}
                data-testid="location-country-input"
              />
            </div>

            <div className="flex flex-col gap-16">
              <label htmlFor="location-state-region" className="label-medium">
                State / Region
              </label>
              <input
                id="location-state-region"
                type="text"
                value={formData.stateRegion}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, stateRegion: e.target.value }))
                }
                placeholder="e.g., Kilimanjaro"
                className={inputClass}
                data-testid="location-state-region-input"
              />
            </div>

            <div className="flex flex-col gap-16">
              <label htmlFor="location-city" className="label-medium">
                City
              </label>
              <input
                id="location-city"
                type="text"
                value={formData.city}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, city: e.target.value }))
                }
                placeholder="e.g., Moshi"
                className={inputClass}
                data-testid="location-city-input"
              />
            </div>
          </div>

          <div className="flex flex-col gap-16">
            <label htmlFor="location-address" className="label-medium">
              Address / Description{" "}
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
                placeholder="e.g., -3.3349"
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
                placeholder="e.g., 37.3404"
                className={inputClass}
                data-testid="location-longitude-input"
              />
            </div>
          </div>

          <div className="flex gap-16 justify-start pt-16">
            <Button
              variant="primary"
              onClick={handleSubmit}
              busy={createLocation.isPending}
              data-testid="location-submit-button"
            >
              {createLocation.isPending ? "Adding..." : "Add Location"}
            </Button>
            <Button
              variant="default"
              onClick={onClose}
              disabled={createLocation.isPending}
            >
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
