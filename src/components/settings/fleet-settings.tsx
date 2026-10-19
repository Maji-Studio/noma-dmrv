/**
 * Settings → Vehicles and crew. The organization's vehicles, drivers and
 * operators in one place, each editable and deletable. The pickers on intake,
 * delivery and production forms create and edit the same records.
 */
"use client";

import { useState } from "react";
import { HardHatIcon, SteeringWheelIcon, TruckIcon } from "@phosphor-icons/react/dist/ssr";
import {
  DriverQuickAddDialog,
  OperatorQuickAddDialog,
  VehicleQuickAddDialog,
} from "@/components/forms/entity-select";
import type { Driver, Operator, Vehicle } from "@/db/schema";
import {
  useDeleteDriver,
  useDeleteOperator,
  useDeleteVehicle,
  useFleetList,
  useInvalidateFleetKind,
} from "@/hooks/use-fleet";
import { formatVehicleType } from "@/schemas/vehicles";
import { FleetSettingsSection } from "./fleet-settings-section";

const EMPTY_ICON_SIZE = 32;

interface DialogState<T> {
  isOpen: boolean;
  /** Null adds a new record. */
  record: T | null;
}

const CLOSED = { isOpen: false, record: null } as const;

/** "a · b", skipping blanks; undefined when nothing is left. */
function joinDetails(parts: ReadonlyArray<string | null | undefined>): string | undefined {
  const present = parts.filter((part): part is string => Boolean(part?.trim()));
  return present.length > 0 ? present.join(" · ") : undefined;
}

function VehicleSection() {
  const query = useFleetList("vehicle");
  const remove = useDeleteVehicle();
  const invalidate = useInvalidateFleetKind();
  const [dialog, setDialog] = useState<DialogState<Vehicle>>(CLOSED);

  return (
    <>
      <FleetSettingsSection<Vehicle>
        title="Vehicles"
        noun="vehicle"
        query={query}
        emptyIcon={<TruckIcon size={EMPTY_ICON_SIZE} />}
        emptyDescription="Vehicles carry feedstock and biochar. Vehicle type and model year are kept as transport evidence."
        primary={(vehicle) => vehicle.name}
        secondary={(vehicle) =>
          joinDetails([vehicle.code, formatVehicleType(vehicle.vehicleType), vehicle.identifier, vehicle.fuelType])
        }
        recordLabel={(vehicle) => `Vehicle ${vehicle.code}`}
        onAdd={() => setDialog({ isOpen: true, record: null })}
        onEdit={(vehicle) => setDialog({ isOpen: true, record: vehicle })}
        onDelete={(vehicle) => remove.mutateAsync({ vehicleId: vehicle.id, expectedVersion: vehicle.version })}
        isDeleting={remove.isPending}
      />
      <VehicleQuickAddDialog
        isOpen={dialog.isOpen}
        onClose={() => setDialog((current) => ({ ...current, isOpen: false }))}
        onSuccess={() => invalidate("vehicle")}
        vehicle={dialog.record}
      />
    </>
  );
}

function DriverSection() {
  const query = useFleetList("driver");
  const remove = useDeleteDriver();
  const invalidate = useInvalidateFleetKind();
  const [dialog, setDialog] = useState<DialogState<Driver>>(CLOSED);

  return (
    <>
      <FleetSettingsSection<Driver>
        title="Drivers"
        noun="driver"
        query={query}
        emptyIcon={<SteeringWheelIcon size={EMPTY_ICON_SIZE} />}
        emptyDescription="Drivers are named on deliveries."
        primary={(driver) => driver.name}
        secondary={(driver) => joinDetails([driver.code, driver.licenseNumber])}
        recordLabel={(driver) => `Driver ${driver.code}`}
        onAdd={() => setDialog({ isOpen: true, record: null })}
        onEdit={(driver) => setDialog({ isOpen: true, record: driver })}
        onDelete={(driver) => remove.mutateAsync({ driverId: driver.id, expectedVersion: driver.version })}
        isDeleting={remove.isPending}
      />
      <DriverQuickAddDialog
        isOpen={dialog.isOpen}
        onClose={() => setDialog((current) => ({ ...current, isOpen: false }))}
        onSuccess={() => invalidate("driver")}
        driver={dialog.record}
      />
    </>
  );
}

function OperatorSection() {
  const query = useFleetList("operator");
  const remove = useDeleteOperator();
  const invalidate = useInvalidateFleetKind();
  const [dialog, setDialog] = useState<DialogState<Operator>>(CLOSED);

  return (
    <>
      <FleetSettingsSection<Operator>
        title="Operators"
        noun="operator"
        query={query}
        emptyIcon={<HardHatIcon size={EMPTY_ICON_SIZE} />}
        emptyDescription="Operators are named on production runs, production incidents and in-process measurements."
        primary={(operator) => operator.name}
        secondary={(operator) => joinDetails([operator.credentials])}
        recordLabel={(operator) => `Operator ${operator.name}`}
        onAdd={() => setDialog({ isOpen: true, record: null })}
        onEdit={(operator) => setDialog({ isOpen: true, record: operator })}
        onDelete={(operator) => remove.mutateAsync({ operatorId: operator.id, expectedVersion: operator.version })}
        isDeleting={remove.isPending}
      />
      <OperatorQuickAddDialog
        isOpen={dialog.isOpen}
        onClose={() => setDialog((current) => ({ ...current, isOpen: false }))}
        onSuccess={() => invalidate("operator")}
        operator={dialog.record}
      />
    </>
  );
}

export function FleetSettings() {
  return (
    <div className="flex flex-col gap-32">
      <VehicleSection />
      <DriverSection />
      <OperatorSection />
    </div>
  );
}
