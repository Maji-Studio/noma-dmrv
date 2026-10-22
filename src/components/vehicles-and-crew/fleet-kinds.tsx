/**
 * Vehicles, drivers and operators as list rows: per kind, the table columns,
 * the columns that start hidden, the read sections of the side sheet and the
 * copy. Used by the Vehicles and crew page.
 */
import type { ReactNode } from "react";
import type { ColumnDef, VisibilityState } from "@tanstack/react-table";
import { HardHatIcon, SteeringWheelIcon, TruckIcon } from "@phosphor-icons/react/dist/ssr";
import { RowActionsMenu } from "@/components/ui";
import type { DetailPanelSection } from "@/components/ui/detail-panel";
import type { Driver, Operator, Vehicle } from "@/db/schema";
import type { FleetRecords } from "@/hooks/use-fleet";
import { MISSING_VALUE } from "@/lib/copy-utils";
import type { FleetKind } from "@/lib/fleet/messages";
import { formatVehicleType, lPerKmToLPer100Km } from "@/schemas/vehicles";

export const FLEET_KINDS = ["vehicle", "driver", "operator"] as const satisfies readonly FleetKind[];

export const EMPTY_ICON_SIZE = 40;

export interface FleetKindCopy {
  /** Plural heading, e.g. "Vehicles". */
  title: string;
  /** Lowercase noun for buttons, e.g. "vehicle". */
  noun: string;
  icon: (size: number) => ReactNode;
  emptyDescription: string;
}

export const FLEET_KIND_COPY: Record<FleetKind, FleetKindCopy> = {
  vehicle: {
    title: "Vehicles",
    noun: "vehicle",
    icon: (size) => <TruckIcon size={size} />,
    emptyDescription: "Vehicles carry feedstock and biochar.",
  },
  driver: {
    title: "Drivers",
    noun: "driver",
    icon: (size) => <SteeringWheelIcon size={size} />,
    emptyDescription: "Drivers are named on deliveries.",
  },
  operator: {
    title: "Operators",
    noun: "operator",
    icon: (size) => <HardHatIcon size={size} />,
    emptyDescription: "Operators are named on production runs, production incidents and in-process measurements.",
  },
};

/** Optional detail an operator can add from the Columns menu (#690). */
export const FLEET_HIDDEN_COLUMNS: Record<FleetKind, VisibilityState> = {
  vehicle: { fuelConsumption: false, modelYear: false },
  driver: { contactPhone: false },
  operator: { contactPhone: false },
};

export interface FleetRowActions<T> {
  onEdit: (record: T) => void;
  onDelete: (record: T) => void;
}

const L_PER_100_KM_DIGITS = 1;

function orMissing(value: string | null | undefined): string {
  return value?.trim() ? value : MISSING_VALUE.notRecorded;
}

function fuelConsumptionText(vehicle: Vehicle): string {
  if (vehicle.fuelType === "Electric") return MISSING_VALUE.notApplicable;
  if (vehicle.fuelConsumptionLPerKm == null) return MISSING_VALUE.notRecorded;
  return lPerKmToLPer100Km(vehicle.fuelConsumptionLPerKm).toLocaleString(undefined, {
    maximumFractionDigits: L_PER_100_KM_DIGITS,
  });
}

function nameColumn<T extends { name: string }>(): ColumnDef<T> {
  return {
    accessorKey: "name",
    meta: { recordLink: true },
    header: "Name",
    cell: ({ row }) => <span className="font-medium text-[var(--color-text-primary)]">{row.original.name}</span>,
  };
}

function codeColumn<T extends { code: string }>(): ColumnDef<T> {
  return {
    accessorKey: "code",
    meta: { nowrap: true },
    header: "Code",
    cell: ({ row }) => <span className="font-mono">{row.original.code}</span>,
  };
}

function actionsColumn<T>(label: (record: T) => string, actions: FleetRowActions<T>): ColumnDef<T> {
  return {
    id: "actions",
    meta: { stickyEnd: true },
    header: "",
    enableSorting: false,
    cell: ({ row }) => (
      <div className="flex justify-end">
        <RowActionsMenu
          label={`Actions for ${label(row.original)}`}
          actions={[
            { label: "Edit", onSelect: () => actions.onEdit(row.original) },
            { label: "Delete", destructive: true, onSelect: () => actions.onDelete(row.original) },
          ]}
        />
      </div>
    ),
  };
}

function vehicleColumns(actions: FleetRowActions<Vehicle>): ColumnDef<Vehicle>[] {
  return [
    nameColumn<Vehicle>(),
    codeColumn<Vehicle>(),
    {
      id: "vehicleType",
      header: "Type",
      accessorFn: (vehicle) => formatVehicleType(vehicle.vehicleType),
    },
    {
      id: "identifier",
      header: "Identifier / plate",
      meta: { nowrap: true },
      accessorFn: (vehicle) => orMissing(vehicle.identifier),
    },
    {
      id: "fuelType",
      header: "Fuel type",
      accessorFn: (vehicle) => orMissing(vehicle.fuelType),
    },
    {
      id: "fuelConsumption",
      header: "Fuel consumption (L/100 km)",
      enableGlobalFilter: false,
      accessorFn: fuelConsumptionText,
    },
    {
      id: "modelYear",
      header: "Model year",
      enableGlobalFilter: false,
      accessorFn: (vehicle) => (vehicle.modelYear == null ? MISSING_VALUE.notRecorded : String(vehicle.modelYear)),
    },
    actionsColumn<Vehicle>((vehicle) => vehicle.name, actions),
  ];
}

function driverColumns(actions: FleetRowActions<Driver>): ColumnDef<Driver>[] {
  return [
    nameColumn<Driver>(),
    codeColumn<Driver>(),
    {
      id: "licenseNumber",
      header: "License number",
      meta: { nowrap: true },
      accessorFn: (driver) => orMissing(driver.licenseNumber),
    },
    {
      id: "contactPhone",
      header: "Contact phone",
      meta: { nowrap: true },
      enableGlobalFilter: false,
      accessorFn: (driver) => orMissing(driver.contactPhone),
    },
    actionsColumn<Driver>((driver) => driver.name, actions),
  ];
}

function operatorColumns(actions: FleetRowActions<Operator>): ColumnDef<Operator>[] {
  return [
    nameColumn<Operator>(),
    {
      id: "credentials",
      header: "Role / credentials",
      accessorFn: (operator) => orMissing(operator.credentials),
    },
    {
      id: "contactPhone",
      header: "Contact phone",
      meta: { nowrap: true },
      enableGlobalFilter: false,
      accessorFn: (operator) => orMissing(operator.contactPhone),
    },
    actionsColumn<Operator>((operator) => operator.name, actions),
  ];
}

const COLUMN_BUILDERS: { [K in FleetKind]: (actions: FleetRowActions<FleetRecords[K]>) => ColumnDef<FleetRecords[K]>[] } = {
  vehicle: vehicleColumns,
  driver: driverColumns,
  operator: operatorColumns,
};

export function fleetColumns<K extends FleetKind>(
  kind: K,
  actions: FleetRowActions<FleetRecords[K]>,
): ColumnDef<FleetRecords[K]>[] {
  const build = COLUMN_BUILDERS[kind] as (rowActions: FleetRowActions<FleetRecords[K]>) => ColumnDef<FleetRecords[K]>[];
  return build(actions);
}

function vehicleSections(vehicle: Vehicle): DetailPanelSection[] {
  return [
    {
      id: "identifier",
      fields: [{ label: "Identifier / plate", value: vehicle.identifier }],
    },
    {
      title: "Transport evidence",
      fields: [
        { label: "Vehicle type", value: formatVehicleType(vehicle.vehicleType) },
        { label: "Fuel type", value: vehicle.fuelType },
        {
          label: "Fuel consumption (L/100 km)",
          value: vehicle.fuelType === "Electric" ? null : vehicle.fuelConsumptionLPerKm == null ? null : fuelConsumptionText(vehicle),
          emptySituation: vehicle.fuelType === "Electric" ? "notApplicable" : "notRecorded",
        },
        { label: "Model year", value: vehicle.modelYear },
      ],
    },
  ];
}

function driverSections(driver: Driver): DetailPanelSection[] {
  return [
    {
      id: "driver",
      fields: [
        { label: "License number", value: driver.licenseNumber },
        { label: "Contact phone", value: driver.contactPhone },
      ],
    },
  ];
}

function operatorSections(operator: Operator): DetailPanelSection[] {
  return [
    {
      id: "operator",
      fields: [
        { label: "Role / credentials", value: operator.credentials },
        { label: "Contact phone", value: operator.contactPhone },
      ],
    },
  ];
}

const SECTION_BUILDERS: { [K in FleetKind]: (record: FleetRecords[K]) => DetailPanelSection[] } = {
  vehicle: vehicleSections,
  driver: driverSections,
  operator: operatorSections,
};

export function fleetSheetSections<K extends FleetKind>(kind: K, record: FleetRecords[K]): DetailPanelSection[] {
  return (SECTION_BUILDERS[kind] as (row: FleetRecords[K]) => DetailPanelSection[])(record);
}

/** The code shown under the name in the sheet header; operators have none. */
export function fleetRecordCode(record: FleetRecords[FleetKind]): string | undefined {
  return "code" in record ? record.code : undefined;
}

/** How a record is named in delete copy, e.g. "Vehicle VEH-26-001". */
export function fleetRecordLabel(kind: FleetKind, record: FleetRecords[FleetKind]): string {
  const noun = FLEET_KIND_COPY[kind].noun;
  const capitalized = noun.charAt(0).toUpperCase() + noun.slice(1);
  return `${capitalized} ${fleetRecordCode(record) ?? record.name}`;
}
