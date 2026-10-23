/**
 * Vehicles and crew: the organization's vehicles, drivers and operators, as a
 * list page under Distribution (Q13). A tab per kind with its count, one
 * DataTable for the open tab, and a header action that follows the tab. Every
 * member can list, create, edit and delete them, as they can from the pickers
 * on intake, delivery and production forms. Not facility-scoped, so it works
 * with no facility chosen.
 *
 * URL: `?tab=driver|operator` (Vehicles stays out of the URL); `?vehicle=<id>`,
 * `?driver=<id>` or `?operator=<id>` opens that record's sheet (with
 * `&mode=edit`, its edit sheet) on its own tab; `?create=1` opens the create
 * sheet of the open tab.
 */
"use client";

import { parseAsString, parseAsStringLiteral, useQueryState } from "nuqs";
import { PlusIcon } from "@phosphor-icons/react/dist/ssr";
import { Button, PageHeader } from "@/components/ui";
import { useOpenCreateIntent } from "@/hooks/use-open-create-intent";
import {
  DRIVER_QUERY_PARAM,
  ENTITY_DEEP_LINK_MODE_PARAM,
  OPERATOR_QUERY_PARAM,
  VEHICLE_QUERY_PARAM,
  entityViewHref,
} from "@/lib/entity-deep-link";
import type { FleetKind } from "@/lib/fleet/messages";
import { VEHICLES_AND_CREW_HREF } from "@/lib/settings/links";
import { FLEET_KIND_COPY, FLEET_KINDS } from "./fleet-kinds";
import { FleetKindTable } from "./fleet-kind-table";
import { FLEET_TAB_PANEL_ID, FleetTabs, fleetTabId } from "./fleet-tabs";
import { useFleetKindManager, type FleetKindManager } from "./use-fleet-kind-manager";
import { VEHICLES_AND_CREW_SUBTITLE } from "./vehicles-and-crew-copy";

const LINK_PARSER = parseAsString.withOptions({ shallow: true, history: "replace" });
const LINK_PARAMS: Record<FleetKind, string> = {
  vehicle: VEHICLE_QUERY_PARAM,
  driver: DRIVER_QUERY_PARAM,
  operator: OPERATOR_QUERY_PARAM,
};

export function VehiclesAndCrewPage() {
  const [tabParam, setTab] = useQueryState(
    "tab",
    parseAsStringLiteral(FLEET_KINDS).withDefault("vehicle").withOptions({ history: "replace", clearOnDefault: true }),
  );
  const [vehicleId, setVehicleId] = useQueryState(VEHICLE_QUERY_PARAM, LINK_PARSER);
  const [driverId, setDriverId] = useQueryState(DRIVER_QUERY_PARAM, LINK_PARSER);
  const [operatorId, setOperatorId] = useQueryState(OPERATOR_QUERY_PARAM, LINK_PARSER);
  const [linkMode, setLinkMode] = useQueryState(ENTITY_DEEP_LINK_MODE_PARAM, LINK_PARSER);
  const linkIds: Record<FleetKind, string | null> = { vehicle: vehicleId, driver: driverId, operator: operatorId };
  const linkSetters: Record<FleetKind, typeof setVehicleId> = {
    vehicle: setVehicleId,
    driver: setDriverId,
    operator: setOperatorId,
  };
  // A kind's link lands on that kind's tab, with or without `?tab=`.
  const tab = FLEET_KINDS.find((kind) => linkIds[kind]) ?? tabParam;

  const clearLinks = () => {
    for (const kind of FLEET_KINDS) void linkSetters[kind](null);
    void setLinkMode(null);
  };

  // Closing a linked sheet keeps the tab the link opened.
  const closeLink = () => {
    void setTab(tab);
    clearLinks();
  };

  const managerOptions = (kind: FleetKind) => ({
    linkedId: linkIds[kind],
    linkedMode: linkMode,
    onLinkClear: closeLink,
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
    clearLinks();
    // A record link belongs to the tab it named.
    void setTab(kind);
  };

  const rowHref = (record: { id: string }) => entityViewHref(VEHICLES_AND_CREW_HREF, LINK_PARAMS[tab], record.id);

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
