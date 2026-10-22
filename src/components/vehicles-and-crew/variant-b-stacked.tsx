/**
 * PROTOTYPE variant B, "Stacked tables": the three kinds one under the other,
 * each a heading with its own "New X" and a table without paging. One search
 * under the page header filters all three tables at once.
 */
"use client";

import { useState } from "react";
import { MagnifyingGlassIcon, PlusIcon, XIcon } from "@phosphor-icons/react/dist/ssr";
import { Button, PageHeader } from "@/components/ui";
import type { FleetKind } from "@/lib/fleet/messages";
import { cn } from "@/lib/utils";
import { FLEET_KIND_COPY } from "./fleet-kinds";
import { FleetKindTable } from "./fleet-kind-table";
import { useFleetKindManager, type FleetKindManager } from "./use-fleet-kind-manager";
import { VEHICLES_AND_CREW_SUBTITLE } from "./vehicles-and-crew-copy";

function PageSearch({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="relative w-full sm:max-w-[320px]">
      <MagnifyingGlassIcon
        size={18}
        aria-hidden
        className="pointer-events-none absolute left-12 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
      />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search vehicles and crew..."
        aria-label="Search vehicles, drivers and operators"
        className={cn(
          "h-40 w-full border border-[var(--color-border-primary)] bg-[var(--color-background-white)] pl-36 body-small placeholder:text-[var(--color-text-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]",
          value ? "pr-40" : "pr-12",
        )}
      />
      {value && (
        <Button
          variant="noOutline"
          size="icon"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute right-4 top-1/2 -translate-y-1/2"
        >
          <XIcon size={16} weight="bold" aria-hidden />
        </Button>
      )}
    </div>
  );
}

function KindSection<K extends FleetKind>({ manager, search }: { manager: FleetKindManager<K>; search: string }) {
  const copy = FLEET_KIND_COPY[manager.kind];
  const headingId = `vehicles-and-crew-${manager.kind}-heading`;
  return (
    <section className="flex flex-col gap-12" aria-labelledby={headingId}>
      <div className="flex flex-wrap items-center justify-between gap-12">
        <h2 id={headingId} className="title-heading-3">
          {copy.title}
        </h2>
        <Button onClick={manager.openCreate}>
          <PlusIcon size={18} weight="bold" />
          New {copy.noun}
        </Button>
      </div>
      <FleetKindTable manager={manager} toolbar="none" search={search} paginate={false} />
    </section>
  );
}

export function VehiclesAndCrewStacked() {
  const [search, setSearch] = useState("");
  const vehicles = useFleetKindManager("vehicle");
  const drivers = useFleetKindManager("driver");
  const operators = useFleetKindManager("operator");

  return (
    <div className="container-max page-shell">
      <PageHeader area="distribution" title="Vehicles and crew" subtitle={VEHICLES_AND_CREW_SUBTITLE} />
      <PageSearch value={search} onChange={setSearch} />
      <KindSection manager={vehicles} search={search} />
      <KindSection manager={drivers} search={search} />
      <KindSection manager={operators} search={search} />

      {vehicles.overlays}
      {drivers.overlays}
      {operators.overlays}
    </div>
  );
}
