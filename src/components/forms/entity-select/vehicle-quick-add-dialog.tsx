/**
 * Vehicle Quick Add Dialog
 * Inline dialog for adding a vehicle from the EntitySelect dropdown, and for
 * editing one when `vehicle` is passed (the picker's edit action and the
 * settings list). Embeds the full VehicleForm inside QuickAddDialogShell.
 */
"use client";

import { useState } from "react";
import { createVehicleFn } from "@/fn/quick-add";
import { VehicleForm } from "@/components/vehicles/vehicle-form";
import { Notice } from "@/components/ui/notice";
import type { Vehicle } from "@/db/schema";
import { lPer100KmToLPerKm, type VehicleFormData } from "@/schemas/vehicles";
import type { VehicleQuickAddData } from "@/schemas/quick-add";
import { useQuickAddSubmit } from "@/hooks/use-quick-add-submit";
import { useUpdateVehicle } from "@/hooks/use-fleet";
import { toSaveErrorMessage } from "@/lib/stale-version";
import { QuickAddDialogShell, stopSubmitBubbling } from "./quick-add-dialog-shell";
import type { EntityOption } from "./types";

interface VehicleQuickAddDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called with the created vehicle. Not called after an edit. */
  onSuccess?: (entity: EntityOption) => void;
  /** Edit this vehicle instead of creating one. */
  vehicle?: Vehicle | null;
}

const VEHICLE_NOT_SAVED = "The vehicle was not saved. Try again.";

/** The form's L/100km becomes the stored L/km; blank or electric is null. */
function toVehiclePayload(data: VehicleFormData): VehicleQuickAddData {
  const isElectric = data.fuelType === "Electric";
  const fuelConsumption =
    isElectric || data.fuelConsumptionLPer100Km == null
      ? null
      : lPer100KmToLPerKm(data.fuelConsumptionLPer100Km);

  return {
    name: data.name.trim(),
    identifier: data.identifier?.trim() || null,
    vehicleType: data.vehicleType,
    fuelType: data.fuelType || null,
    fuelConsumptionLPerKm: fuelConsumption,
    modelYear: data.modelYear ?? null,
  };
}

export function VehicleQuickAddDialog({
  isOpen,
  onClose,
  onSuccess,
  vehicle,
}: VehicleQuickAddDialogProps) {
  const create = useQuickAddSubmit<VehicleFormData>({
    entityType: "vehicle",
    serverFn: (data) => createVehicleFn(toVehiclePayload(data)),
    onSuccess: (entity) => onSuccess?.(entity),
    onClose,
  });
  const update = useUpdateVehicle();
  const [editError, setEditError] = useState<string | null>(null);

  const handleEdit = async (data: VehicleFormData) => {
    if (!vehicle) return;
    setEditError(null);
    try {
      await update.mutateAsync({
        ...toVehiclePayload(data),
        vehicleId: vehicle.id,
        expectedVersion: vehicle.version,
      });
      onClose();
    } catch (error) {
      setEditError(toSaveErrorMessage(error, VEHICLE_NOT_SAVED));
    }
  };

  const isEdit = Boolean(vehicle);
  const isSubmitting = isEdit ? update.isPending : create.isSubmitting;
  const error = isEdit ? editError : create.error;

  return (
    <QuickAddDialogShell
      isOpen={isOpen}
      onClose={onClose}
      onOpen={() => setEditError(null)}
      title={isEdit ? "Edit vehicle" : "New vehicle"}
      testId={isEdit ? "vehicle-edit-dialog" : "vehicle-quick-add-dialog"}
      dismissible={!isSubmitting}
    >
      {isEdit && (
        <Notice tone="info">
          The vehicle type applies to every feedstock intake that uses this vehicle. It cannot change while a submitted credit batch uses it.
        </Notice>
      )}
      <div className="contents" onSubmit={stopSubmitBubbling}>
        <VehicleForm
          key={vehicle ? `${vehicle.id}:${vehicle.version}` : "new"}
          vehicle={vehicle ?? undefined}
          onSubmit={isEdit ? handleEdit : create.handleSubmit}
          onCancel={onClose}
          isSubmitting={isSubmitting}
          errorMessage={error ?? undefined}
          submitLabel={isEdit ? "Save vehicle" : "Create vehicle"}
        />
      </div>
    </QuickAddDialogShell>
  );
}
