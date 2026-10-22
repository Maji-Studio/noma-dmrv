/**
 * PROTOTYPE variant A, "Tabs": one list page, a tab per kind with its count,
 * one DataTable for the open tab. The header's primary action follows the tab.
 * The tab lives in `?tab=` (Vehicles stays out of the URL).
 */
"use client";

import { parseAsStringLiteral, useQueryState } from "nuqs";
import { PlusIcon } from "@phosphor-icons/react/dist/ssr";
import { Button, PageHeader } from "@/components/ui";
import type { FleetKind } from "@/lib/fleet/messages";
import { cn } from "@/lib/utils";
import { FLEET_KIND_COPY, FLEET_KINDS } from "./fleet-kinds";
import { FleetKindTable } from "./fleet-kind-table";
import { useFleetKindManager, type FleetKindManager } from "./use-fleet-kind-manager";
import { VEHICLES_AND_CREW_SUBTITLE } from "./vehicles-and-crew-copy";

const TAB_PANEL_ID = "vehicles-and-crew-tab-panel";
const FOCUS_RING = "outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ink)]";

export function VehiclesAndCrewTabs() {
  const [tab, setTab] = useQueryState(
    "tab",
    parseAsStringLiteral(FLEET_KINDS).withDefault("vehicle").withOptions({ history: "replace", clearOnDefault: true }),
  );
  const managers = {
    vehicle: useFleetKindManager("vehicle"),
    driver: useFleetKindManager("driver"),
    operator: useFleetKindManager("operator"),
  };
  const active = managers[tab];
  const copy = FLEET_KIND_COPY[tab];

  return (
    <div className="container-max page-shell">
      <PageHeader
        area="distribution"
        title="Vehicles and crew"
        subtitle={VEHICLES_AND_CREW_SUBTITLE}
        actions={
          <Button variant="primary" onClick={active.openCreate}>
            <PlusIcon size={20} weight="bold" />
            New {copy.noun}
          </Button>
        }
      />

      <div className="flex flex-col gap-16">
        <div
          role="tablist"
          aria-label="Vehicles and crew"
          className="flex overflow-x-auto border-b border-[var(--color-border-secondary)]"
        >
          {FLEET_KINDS.map((kind) => {
            const selected = tab === kind;
            const manager = managers[kind];
            return (
              <button
                key={kind}
                id={`vehicles-and-crew-tab-${kind}`}
                role="tab"
                type="button"
                aria-selected={selected}
                aria-controls={TAB_PANEL_ID}
                onClick={() => void setTab(kind)}
                className={cn(
                  "-mb-px inline-flex h-44 shrink-0 items-center gap-8 border-b-2 px-16 body-medium first:pl-0",
                  FOCUS_RING,
                  selected
                    ? "border-[var(--ink)] font-medium"
                    : "border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]",
                )}
              >
                {FLEET_KIND_COPY[kind].title}
                {!manager.isLoading && !manager.error && (
                  <span className="body-small tabular-nums text-[var(--color-text-tertiary)]">{manager.records.length}</span>
                )}
              </button>
            );
          })}
        </div>

        <div id={TAB_PANEL_ID} role="tabpanel" aria-labelledby={`vehicles-and-crew-tab-${tab}`}>
          {/* Keyed so search, sort and paging start fresh on each tab. */}
          <FleetKindTable key={tab} manager={active as FleetKindManager<FleetKind>} />
        </div>
      </div>

      {managers.vehicle.overlays}
      {managers.driver.overlays}
      {managers.operator.overlays}
    </div>
  );
}
