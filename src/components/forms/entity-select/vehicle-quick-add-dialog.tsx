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
      // Fuel consumption is optional metadata: null when blank or electric
      // (no liquid fuel), otherwise converted from the L/100km the form uses.
      const isElectric = data.fuelType === "Electric";
      const fuelConsumption =
        isElectric || data.fuelConsumptionLPer100Km == null
          ? null
          : lPer100KmToLPerKm(data.fuelConsumptionLPer100Km);

      return createVehicleFn({
        name: data.name.trim(),
        identifier: data.identifier?.trim() || null,
        vehicleType: data.vehicleType,
        fuelType: data.fuelType || null,
        fuelConsumptionLPerKm: fuelConsumption,
        modelYear: data.modelYear ?? null,
      });
    },
    onSuccess,
    onClose,
  });

  return (
    <QuickAddDialogShell
      isOpen={isOpen}
      onClose={onClose}
      title="New vehicle"
      testId="vehicle-quick-add-dialog"
    >
      <VehicleForm
        onSubmit={handleSubmit}
        onCancel={onClose}
        isSubmitting={isSubmitting}
        errorMessage={error ?? undefined}
        submitLabel="Create vehicle"
      />
    </QuickAddDialogShell>
  );
}
