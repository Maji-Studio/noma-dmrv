/**
 * Settings, Facilities: the certification settings of the working facility
 * (Q14: the facility follows the sidebar's selector, there is no second
 * picker here). Its registry project link, its durability tier (Q9, moved out
 * of the facility form) and the reference soil temperature.
 *
 * The soil reference only feeds the 200-year model, so on the 1000-year tier
 * it is hidden behind one quiet line instead of a "Not used" notice (Q11).
 * Site details (name, country, timezone, address) stay in the facility form.
 */
"use client";

import type { ReactNode } from "react";
import { EmissionEstimatesForm } from "@/components/admin/emission-estimates-form";
import { FacilityCertifierSection } from "@/components/certification/facility-certifier-section";
import { SelectFacilityEmptyState } from "@/components/navigation";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { DetailField } from "@/components/ui/detail-panel";
import { ServerError } from "@/components/forms";
import { useFacilityCertifierSummary } from "@/hooks/use-certification";
import { useFacilityContext } from "@/hooks/use-facility-context";
import type { SettingsViewer } from "@/lib/settings/panes";
import { DurabilityTierSettings } from "./durability-tier-settings";

/** The durability tier the soil reference temperature is configuration for. */
const SOIL_MODELLED_TIER = "200_year";

export const SOIL_REFERENCE_NOT_USED_TEXT =
  "No soil reference temperature: only the 200-year model uses it.";

/** A hairline-separated block; untitled when its one field already names it. */
function PaneSection({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-12 border-t-[1px] border-[var(--clr-dark-purple-10)] pt-16 first:border-t-0 first:pt-0">
      {title && <h3 className="body-caption text-[var(--color-text-tertiary)]">{title}</h3>}
      {children}
    </section>
  );
}

export function FacilitySettingsPane({ viewer }: { viewer: SettingsViewer }) {
  const { facilityId, selectedFacility } = useFacilityContext();
  const { data: summary, isLoading, error } = useFacilityCertifierSummary(
    facilityId ?? "",
    !!facilityId,
  );

  if (!facilityId || !selectedFacility) {
    return (
      <SelectFacilityEmptyState description="Choose a facility from the sidebar to configure its certification settings." />
    );
  }

  const canManage = viewer.canManage;
  const soilModelled = selectedFacility.durabilityOption === SOIL_MODELLED_TIER;

  return (
    <div className="flex flex-col gap-24">
      <PaneSection title="Registry project">
        <FacilityCertifierSection
          key={`facility-certifier-${facilityId}`}
          facilityId={facilityId}
          canManage={canManage}
          embedded
        />
      </PaneSection>

      <PaneSection>
        <DurabilityTierSettings facility={selectedFacility} canManage={canManage} />
        {!soilModelled ? (
          <p className="body-small text-[var(--color-text-tertiary)]">{SOIL_REFERENCE_NOT_USED_TEXT}</p>
        ) : isLoading ? (
          <Skeleton className="h-160 w-full" />
        ) : error || !summary ? (
          <ServerError message="Couldn't load the soil reference temperature. Refresh the page to retry." />
        ) : canManage ? (
          // The form seeds its defaultValues from `mapping` at mount, so it
          // must not mount before the summary lands or saved values render blank.
          <EmissionEstimatesForm
            key={`emission-estimates-${facilityId}`}
            facilityId={facilityId}
            mapping={summary.mapping ?? null}
            durabilityOption={SOIL_MODELLED_TIER}
          />
        ) : (
          <DetailField
            label="Reference soil temperature (°C)"
            value={summary.mapping?.defaultSoilTemperatureC ?? null}
            emptySituation="notSet"
          />
        )}
      </PaneSection>
    </div>
  );
}
