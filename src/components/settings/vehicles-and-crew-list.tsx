/**
 * Vehicles and crew: the organization's vehicles, drivers and operators, as a
 * list page under Distribution (Q13). It was a settings pane, but these are
 * records operators add and correct every day, like suppliers, so they sit
 * with the other master data. Every member can list, edit and delete them, as
 * they can create them from the pickers on intake, delivery and production
 * forms.
 */
"use client";

import { PageHeader } from "@/components/ui";
import { FleetSettings } from "./fleet-settings";

export function VehiclesAndCrewList() {
  return (
    <div className="container-max page-shell">
      <PageHeader
        area="distribution"
        title="Vehicles and crew"
        subtitle="The vehicles, drivers and operators your records name. Vehicle type and model year are kept as transport evidence."
      />
      <section className="bg-[var(--panel-bg)] p-16 [border:var(--panel-border)] [box-shadow:var(--panel-shadow)] sm:p-24">
        <FleetSettings />
      </section>
    </div>
  );
}
