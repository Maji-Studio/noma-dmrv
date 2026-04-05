/**
 * Vehicle Quick Add Dialog
 * Inline dialog for quickly adding new vehicles from EntitySelect dropdown.
 * Embeds the full VehicleForm inside QuickAddDialogShell.
 */
"use client";

import { createVehicleFn } from "@/fn/quick-add";
import { VehicleForm } from "@/components/vehicles/vehicle-form";
import { lPer100KmToLPerKm, type VehicleFormData } from "@/schemas/vehicles";
import { useQuickAddSubmit } from "@/hooks/use-quick-add-submit";
import { QuickAddDialogShell } from "./quick-add-dialog-shell";
import type { EntityOption } from "./types";

interface VehicleQuickAddDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (entity: EntityOption) => void;
}

export function VehicleQuickAddDialog({
  isOpen,
  onClose,
  onSuccess,
}: VehicleQuickAddDialogProps) {
  const { error, isSubmitting, handleSubmit } = useQuickAddSubmit<VehicleFormData>({
    entityType: "vehicle",
    serverFn: (data) => {
      const isElectric = data.fuelType === "Electric";
      const fuelConsumption = isElectric
        ? 0
        : lPer100KmToLPerKm(data.fuelConsumptionLPer100Km ?? 0);

      return createVehicleFn({
        name: data.name.trim(),
        identifier: data.identifier.trim(),
        vehicleType: data.vehicleType,
        fuelType: data.fuelType,
        fuelConsumptionLPerKm: fuelConsumption,
        modelYear: data.modelYear,
      });
    },
    onSuccess,
    onClose,
  });

  return (
    <QuickAddDialogShell
      isOpen={isOpen}
      onClose={onClose}
      title="Add New Vehicle"
      error={error}
      testId="vehicle-quick-add-dialog"
    >
      <VehicleForm
        onSubmit={handleSubmit}
        onCancel={onClose}
        isSubmitting={isSubmitting}
        submitLabel="Create Vehicle"
      />
    </QuickAddDialogShell>
  );
}
