/**
 * Vehicles and crew: the organization's vehicles, drivers and operators, as a
 * list page under Distribution (Q13). A tab per kind with its count, one
 * DataTable for the open tab, and a header action that follows the tab. Every
 * member can list, create, edit and delete them, as they can from the pickers
 * on intake, delivery and production forms. Not facility-scoped, so it works
 * with no facility chosen.
 *
 * URL: `?tab=driver|operator` (Vehicles stays out of the URL), `?record=<id>`
 * opens that record's sheet on the open tab, `?create=1` opens its create sheet.
 */
"use client";

import { parseAsString, parseAsStringLiteral, useQueryState } from "nuqs";
import { PlusIcon } from "@phosphor-icons/react/dist/ssr";
import { Button, PageHeader } from "@/components/ui";
import { useOpenCreateIntent } from "@/hooks/use-open-create-intent";
import type { FleetKind } from "@/lib/fleet/messages";
import { FLEET_KIND_COPY, FLEET_KINDS } from "./fleet-kinds";
import { FleetKindTable } from "./fleet-kind-table";
import { FLEET_TAB_PANEL_ID, FleetTabs, fleetTabId } from "./fleet-tabs";
import { useFleetKindManager, type FleetKindManager } from "./use-fleet-kind-manager";
import { VEHICLES_AND_CREW_SUBTITLE } from "./vehicles-and-crew-copy";

export function VehiclesAndCrewPage() {
  const [tab, setTab] = useQueryState(
    "tab",
    parseAsStringLiteral(FLEET_KINDS).withDefault("vehicle").withOptions({ history: "replace", clearOnDefault: true }),
  );
  const [recordId, setRecordId] = useQueryState("record", parseAsString.withOptions({ history: "replace" }));
  const clearRecord = () => void setRecordId(null);

  const managerOptions = (kind: FleetKind) => ({
    linkedId: tab === kind ? recordId : null,
    onLinkClear: clearRecord,
  });
  const managers = {
    vehicle: useFleetKindManager("vehicle", managerOptions("vehicle")),
    driver: useFleetKindManager("driver", managerOptions("driver")),
    operator: useFleetKindManager("operator", managerOptions("operator")),
  };
  const active = managers[tab];
  const copy = FLEET_KIND_COPY[tab];

  useOpenCreateIntent(active.openCreate);

  const counts = Object.fromEntries(
    FLEET_KINDS.map((kind) => [kind, managers[kind].isLoading || managers[kind].error ? undefined : managers[kind].records.length]),
  ) as Record<FleetKind, number | undefined>;

  const changeTab = (kind: FleetKind) => {
    if (kind === tab) return;
    void setTab(kind);
    // A record link belongs to the tab it named.
    clearRecord();
  };

  const rowHref = (record: { id: string }) => {
    const params = new URLSearchParams();
    if (tab !== "vehicle") params.set("tab", tab);
    params.set("record", record.id);
    return `/vehicles-and-crew?${params.toString()}`;
  };

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
        <FleetTabs tab={tab} counts={counts} onChange={changeTab} />

        <div id={FLEET_TAB_PANEL_ID} role="tabpanel" aria-labelledby={fleetTabId(tab)}>
          {/* Keyed so search, sort and paging start fresh on each tab. */}
          <FleetKindTable key={tab} manager={active as FleetKindManager<FleetKind>} getRowHref={rowHref} />
        </div>
      </div>

      {managers.vehicle.overlays}
      {managers.driver.overlays}
      {managers.operator.overlays}
    </div>
  );
}
