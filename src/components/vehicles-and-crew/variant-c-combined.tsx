/**
 * PROTOTYPE variant C, "One list": every vehicle, driver and operator in one
 * table with a Kind column, so one search finds "Juma" without knowing which
 * list he is on. The kind filter (`?kind=`) narrows it to that kind's own
 * columns and Columns menu; the primary action follows the filter.
 */
"use client";

import { useState } from "react";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import type { ColumnDef } from "@tanstack/react-table";
import { PlusIcon, UsersThreeIcon } from "@phosphor-icons/react/dist/ssr";
import { ServerError } from "@/components/forms";
import { Button, EmptyState, PageHeader, RowActionsMenu, SplitButton } from "@/components/ui";
import { DataTable } from "@/components/ui/data-table";
import type { FleetRecords } from "@/hooks/use-fleet";
import { MISSING_VALUE } from "@/lib/copy-utils";
import type { FleetKind } from "@/lib/fleet/messages";
import { formatVehicleType } from "@/schemas/vehicles";
import { EMPTY_ICON_SIZE, FLEET_KIND_COPY, FLEET_KINDS, fleetRecordCode } from "./fleet-kinds";
import { FleetKindTable } from "./fleet-kind-table";
import { useFleetKindManager, type FleetKindManager } from "./use-fleet-kind-manager";
import { VEHICLES_AND_CREW_SUBTITLE } from "./vehicles-and-crew-copy";

const KIND_FILTERS = ["all", ...FLEET_KINDS] as const;
type KindFilter = (typeof KIND_FILTERS)[number];

const KIND_LABEL: Record<FleetKind, string> = { vehicle: "Vehicle", driver: "Driver", operator: "Operator" };

interface CrewRow {
  id: string;
  kind: FleetKind;
  record: FleetRecords[FleetKind];
  name: string;
  code: string;
  details: string;
}

function joinPresent(parts: ReadonlyArray<string | null | undefined>): string {
  const present = parts.filter((part): part is string => Boolean(part?.trim()));
  return present.length > 0 ? present.join(", ") : MISSING_VALUE.notRecorded;
}

function toRows(managers: { [K in FleetKind]: FleetKindManager<K> }): CrewRow[] {
  const vehicles = managers.vehicle.records.map((vehicle) => ({
    kind: "vehicle" as const,
    record: vehicle,
    details: joinPresent([formatVehicleType(vehicle.vehicleType), vehicle.identifier, vehicle.fuelType]),
  }));
  const drivers = managers.driver.records.map((driver) => ({
    kind: "driver" as const,
    record: driver,
    details: joinPresent([driver.licenseNumber]),
  }));
  const operators = managers.operator.records.map((operator) => ({
    kind: "operator" as const,
    record: operator,
    details: joinPresent([operator.credentials]),
  }));
  return [...vehicles, ...drivers, ...operators].map((row) => ({
    ...row,
    id: `${row.kind}:${row.record.id}`,
    name: row.record.name,
    code: fleetRecordCode(row.record) ?? MISSING_VALUE.notApplicable,
  }));
}

function combinedColumns(
  onEdit: (row: CrewRow) => void,
  onDelete: (row: CrewRow) => void,
): ColumnDef<CrewRow>[] {
  return [
    {
      accessorKey: "name",
      meta: { recordLink: true },
      header: "Name",
      cell: ({ row }) => <span className="font-medium text-[var(--color-text-primary)]">{row.original.name}</span>,
    },
    { id: "kind", header: "Kind", accessorFn: (row) => KIND_LABEL[row.kind] },
    {
      accessorKey: "code",
      meta: { nowrap: true },
      header: "Code",
      cell: ({ row }) =>
        row.original.kind === "operator" ? row.original.code : <span className="font-mono">{row.original.code}</span>,
    },
    { accessorKey: "details", header: "Details", cell: ({ row }) => <span className="block max-w-xs truncate">{row.original.details}</span> },
    {
      id: "actions",
      meta: { stickyEnd: true },
      header: "",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <RowActionsMenu
            label={`Actions for ${row.original.name}`}
            actions={[
              { label: "Edit", onSelect: () => onEdit(row.original) },
              { label: "Delete", destructive: true, onSelect: () => onDelete(row.original) },
            ]}
          />
        </div>
      ),
    },
  ];
}

export function VehiclesAndCrewCombined() {
  const [kindFilter, setKindFilter] = useQueryState(
    "kind",
    parseAsStringLiteral(KIND_FILTERS).withDefault("all").withOptions({ history: "replace", clearOnDefault: true }),
  );
  const [search, setSearch] = useState("");
  const managers = {
    vehicle: useFleetKindManager("vehicle"),
    driver: useFleetKindManager("driver"),
    operator: useFleetKindManager("operator"),
  };
  const createKind: FleetKind = kindFilter === "all" ? "vehicle" : kindFilter;
  const otherKinds = FLEET_KINDS.filter((kind) => kind !== createKind);

  const kindSelect = (
    <DataTable.FilterSelect
      aria-label="Show kind"
      value={kindFilter}
      onChange={(event) => void setKindFilter(event.target.value as KindFilter)}
    >
      <option value="all">All kinds</option>
      {FLEET_KINDS.map((kind) => (
        <option key={kind} value={kind}>
          {FLEET_KIND_COPY[kind].title}
          {managers[kind].isLoading ? "" : ` (${managers[kind].records.length})`}
        </option>
      ))}
    </DataTable.FilterSelect>
  );

  const anyError = FLEET_KINDS.find((kind) => managers[kind].error);
  const isLoading = FLEET_KINDS.some((kind) => managers[kind].isLoading);
  const rows = toRows(managers);
  const hasSearch = search.trim().length > 0;
  const dispatch = (row: CrewRow, action: "openView" | "openEdit" | "requestDelete") =>
    (managers[row.kind][action] as (record: FleetRecords[FleetKind]) => void)(row.record);

  let body;
  if (kindFilter !== "all") {
    body = (
      <FleetKindTable
        key={kindFilter}
        manager={managers[kindFilter] as FleetKindManager<FleetKind>}
        search={search}
        onSearchChange={setSearch}
        extraControls={kindSelect}
      />
    );
  } else if (anyError) {
    body = (
      <ServerError
        message={`${FLEET_KIND_COPY[anyError].title} could not be loaded. Try again.`}
        action={
          <Button size="small" onClick={managers[anyError].refetch}>
            Try again
          </Button>
        }
      />
    );
  } else {
    body = (
      <DataTable<CrewRow, unknown>
        columns={combinedColumns((row) => dispatch(row, "openEdit"), (row) => dispatch(row, "requestDelete"))}
        data={rows}
        onRowClick={(row) => dispatch(row, "openView")}
        enableSorting
        enableFiltering
        enablePagination
        globalFilter={search}
        onGlobalFilterChange={setSearch}
        aria-label="Vehicles and crew"
        isLoading={isLoading}
        hoverable
        emptyMessage={
          <EmptyState
            padding="md"
            icon={<UsersThreeIcon size={EMPTY_ICON_SIZE} />}
            title={hasSearch ? "No matching vehicles or crew" : "No vehicles or crew yet"}
            description={hasSearch ? "Try clearing your search." : "Vehicles carry feedstock and biochar. Drivers and operators are named on the records they work on."}
          />
        }
      >
        <DataTable.Toolbar>
          <DataTable.Search placeholder="Search vehicles and crew..." aria-label="Search vehicles, drivers and operators" />
          <DataTable.Controls>{kindSelect}</DataTable.Controls>
        </DataTable.Toolbar>
        <DataTable.Pagination />
      </DataTable>
    );
  }

  return (
    <div className="container-max page-shell">
      <PageHeader
        area="distribution"
        title="Vehicles and crew"
        subtitle={VEHICLES_AND_CREW_SUBTITLE}
        actions={
          <SplitButton
            onClick={managers[createKind].openCreate}
            menuLabel="Add another kind"
            items={otherKinds.map((kind) => ({
              label: `New ${FLEET_KIND_COPY[kind].noun}`,
              onSelect: managers[kind].openCreate,
            }))}
          >
            <PlusIcon size={20} weight="bold" />
            New {FLEET_KIND_COPY[createKind].noun}
          </SplitButton>
        }
      />

      {body}

      {managers.vehicle.overlays}
      {managers.driver.overlays}
      {managers.operator.overlays}
    </div>
  );
}
