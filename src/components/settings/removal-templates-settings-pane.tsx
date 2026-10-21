/**
 * Settings, Removal templates (Q10): a summary card for the working facility's
 * default Removal template, with the setup dialog (#1276) behind its buttons.
 * Removal readiness blockers link here, so every member can read which
 * components block a Removal; only Admins set templates up.
 *
 * `?setup=` (with `template` and `makeDefault`) opens the dialog; the credit
 * batch "Decide components" links arrive that way.
 */
"use client";

import { RemovalTemplateSummaryCard } from "@/components/certification/removal-template-summary-card";
import { SelectFacilityEmptyState } from "@/components/navigation";
import { useFacilityContext } from "@/hooks/use-facility-context";

export function RemovalTemplatesSettingsPane() {
  const { facilityId } = useFacilityContext();

  if (!facilityId) {
    return (
      <SelectFacilityEmptyState description="Choose a facility from the sidebar to review its Removal templates." />
    );
  }

  return (
    <RemovalTemplateSummaryCard
      key={`removal-template-summary-${facilityId}`}
      facilityId={facilityId}
    />
  );
}
