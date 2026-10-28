/**
 * Vehicles: the organization's vehicles, as a list page under Setup. One
 * DataTable and a "New vehicle" header action. Every member can list, create,
 * edit and delete them, as they can from the pickers on intake and delivery
 * forms. Not facility-scoped, so it works with no facility chosen.
 *
 * URL: `?vehicle=<id>` opens that record's sheet (with `&mode=edit`, its edit
 * sheet); `?create=1` opens the create sheet. Drivers and operators live on
 * the Crew page.
 */
"use client";

import { parseAsString, useQueryState } from "nuqs";
import { PlusIcon } from "@phosphor-icons/react/dist/ssr";
import { Button, PageHeader } from "@/components/ui";
import { useOpenCreateIntent } from "@/hooks/use-open-create-intent";
import { ENTITY_DEEP_LINK_MODE_PARAM, VEHICLE_QUERY_PARAM, entityViewHref } from "@/lib/entity-deep-link";
import { VEHICLES_HREF } from "@/lib/settings/links";
import { FLEET_KIND_COPY } from "./fleet-kinds";
import { FleetKindTable } from "./fleet-kind-table";
import { FLEET_SUBTITLE } from "./fleet-copy";
import { useFleetKindManager } from "./use-fleet-kind-manager";

const LINK_PARSER = parseAsString.withOptions({ shallow: true, history: "replace" });

export function VehiclesPage() {
  const [vehicleId, setVehicleId] = useQueryState(VEHICLE_QUERY_PARAM, LINK_PARSER);
  const [linkMode, setLinkMode] = useQueryState(ENTITY_DEEP_LINK_MODE_PARAM, LINK_PARSER);

  const manager = useFleetKindManager("vehicle", {
    linkedId: vehicleId,
    linkedMode: linkMode,
    onLinkClear: () => {
      void setVehicleId(null);
      void setLinkMode(null);
    },
  });
  const copy = FLEET_KIND_COPY.vehicle;

  useOpenCreateIntent(manager.openCreate);

  const rowHref = (record: { id: string }) => entityViewHref(VEHICLES_HREF, VEHICLE_QUERY_PARAM, record.id);

  return (
    <div className="container-max page-shell">
      <PageHeader
        area="setup"
        title={copy.title}
        subtitle={FLEET_SUBTITLE}
        actions={
          <Button variant="primary" onClick={manager.openCreate}>
            <PlusIcon size={20} weight="bold" />
            New {copy.noun}
          </Button>
        }
      />

      <FleetKindTable manager={manager} getRowHref={rowHref} />

      {manager.overlays}
    </div>
  );
}
