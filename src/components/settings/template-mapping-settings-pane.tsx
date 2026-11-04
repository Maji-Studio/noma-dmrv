/**
 * Settings, Template mapping (Platform Admins): the read-only mapping and
 * Removal compilation traces for the working facility's Removal template.
 */
"use client";

import { RemovalTemplateDiagnosticPanel } from "@/components/certification/removal-template-diagnostic-panel";
import { SelectFacilityEmptyState } from "@/components/navigation";
import { useFacilityContext } from "@/hooks/use-facility-context";

export function TemplateMappingSettingsPane() {
  const { facilityId } = useFacilityContext();
  if (!facilityId) {
    return (
      <SelectFacilityEmptyState description="Choose a facility from the sidebar to view its template mapping." />
    );
  }
  return <RemovalTemplateDiagnosticPanel facilityId={facilityId} />;
}
