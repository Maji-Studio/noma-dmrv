/**
 * The create and edit forms of the Vehicles and crew side sheet. They reuse
 * the vehicle, driver and operator forms and the save paths of the picker
 * dialogs (the same create actions, payloads and update mutations).
 */
"use client";

import { useState } from "react";
import { DriverForm } from "@/components/drivers/driver-form";
import { toDriverPayload } from "@/components/forms/entity-select/driver-quick-add-dialog";
import { toOperatorPayload } from "@/components/forms/entity-select/operator-quick-add-dialog";
import { toVehiclePayload } from "@/components/forms/entity-select/vehicle-quick-add-dialog";
import { OperatorForm } from "@/components/operators/operator-form";
import { VehicleForm } from "@/components/vehicles/vehicle-form";
import type { Driver, Operator, Vehicle } from "@/db/schema";
import { createDriverFn, createOperatorFn, createVehicleFn } from "@/fn/quick-add";
import {
  useInvalidateFleetKind,
  useUpdateDriver,
  useUpdateOperator,
  useUpdateVehicle,
  type FleetRecords,
} from "@/hooks/use-fleet";
import { useQuickAddSubmit } from "@/hooks/use-quick-add-submit";
import type { FleetKind } from "@/lib/fleet/messages";
import { toSaveErrorMessage } from "@/lib/stale-version";
import type { DriverFormData } from "@/schemas/drivers";
import type { OperatorFormData } from "@/schemas/operators";
import type { VehicleFormData } from "@/schemas/vehicles";

const SAVE_CHANGES = "Save changes";
const NOOP = () => undefined;

interface SheetFormProps<T> {
  /** Null creates a new record. */
  record: T | null;
  /** Called after a save with the toast message. */
  onSaved: (message: string) => void;
  onCancel: () => void;
}

function VehicleSheetForm({ record, onSaved, onCancel }: SheetFormProps<Vehicle>) {
  const invalidate = useInvalidateFleetKind();
  const create = useQuickAddSubmit<VehicleFormData>({
    entityType: "vehicle",
    serverFn: (data, intentKey) => createVehicleFn(toVehiclePayload(data), { intentKey }),
    onSuccess: () => {
      invalidate("vehicle");
      onSaved("Vehicle created.");
    },
    onClose: NOOP,
  });
  const update = useUpdateVehicle();
  const [editError, setEditError] = useState<string | null>(null);

  const handleEdit = async (data: VehicleFormData) => {
    if (!record) return;
    setEditError(null);
    try {
      await update.mutateAsync({ ...toVehiclePayload(data), vehicleId: record.id, expectedVersion: record.version });
      onSaved("Vehicle updated.");
    } catch (error) {
      setEditError(toSaveErrorMessage(error, "The vehicle was not saved. Try again."));
    }
  };

  return (
    <VehicleForm
      vehicle={record ?? undefined}
      onSubmit={record ? handleEdit : create.handleSubmit}
      onCancel={onCancel}
      isSubmitting={record ? update.isPending : create.isSubmitting}
      errorMessage={(record ? editError : create.error) ?? undefined}
      submitLabel={record ? SAVE_CHANGES : "Create vehicle"}
    />
  );
}

function DriverSheetForm({ record, onSaved, onCancel }: SheetFormProps<Driver>) {
  const invalidate = useInvalidateFleetKind();
  const create = useQuickAddSubmit<DriverFormData>({
    entityType: "driver",
    serverFn: (data, intentKey) => createDriverFn(toDriverPayload(data), { intentKey }),
    onSuccess: () => {
      invalidate("driver");
      onSaved("Driver created.");
    },
    onClose: NOOP,
  });
  const update = useUpdateDriver();
  const [editError, setEditError] = useState<string | null>(null);

  const handleEdit = async (data: DriverFormData) => {
    if (!record) return;
    setEditError(null);
    try {
      await update.mutateAsync({ ...toDriverPayload(data), driverId: record.id, expectedVersion: record.version });
      onSaved("Driver updated.");
    } catch (error) {
      setEditError(toSaveErrorMessage(error, "The driver was not saved. Try again."));
    }
  };

  return (
    <DriverForm
      driver={record ?? undefined}
      onSubmit={record ? handleEdit : create.handleSubmit}
      onCancel={onCancel}
      isSubmitting={record ? update.isPending : create.isSubmitting}
      errorMessage={(record ? editError : create.error) ?? undefined}
      submitLabel={record ? SAVE_CHANGES : "Create driver"}
    />
  );
}

function OperatorSheetForm({ record, onSaved, onCancel }: SheetFormProps<Operator>) {
  const invalidate = useInvalidateFleetKind();
  const create = useQuickAddSubmit<OperatorFormData>({
    entityType: "operator",
    serverFn: (data, intentKey) => createOperatorFn(toOperatorPayload(data), { intentKey }),
    onSuccess: () => {
      invalidate("operator");
      onSaved("Operator created.");
    },
    onClose: NOOP,
  });
  const update = useUpdateOperator();
  const [editError, setEditError] = useState<string | null>(null);

  const handleEdit = async (data: OperatorFormData) => {
    if (!record) return;
    setEditError(null);
    try {
      await update.mutateAsync({ ...toOperatorPayload(data), operatorId: record.id, expectedVersion: record.version });
      onSaved("Operator updated.");
    } catch (error) {
      setEditError(toSaveErrorMessage(error, "The operator was not saved. Try again."));
    }
  };

  return (
    <OperatorForm
      operator={record ?? undefined}
      onSubmit={record ? handleEdit : create.handleSubmit}
      onCancel={onCancel}
      isSubmitting={record ? update.isPending : create.isSubmitting}
      errorMessage={(record ? editError : create.error) ?? undefined}
      submitLabel={record ? SAVE_CHANGES : "Create operator"}
    />
  );
}

export function FleetSheetForm<K extends FleetKind>({
  kind,
  ...props
}: SheetFormProps<FleetRecords[K]> & { kind: K }) {
  switch (kind) {
    case "vehicle":
      return <VehicleSheetForm {...(props as SheetFormProps<Vehicle>)} />;
    case "driver":
      return <DriverSheetForm {...(props as SheetFormProps<Driver>)} />;
    default:
      return <OperatorSheetForm {...(props as SheetFormProps<Operator>)} />;
  }
}
