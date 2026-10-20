/**
 * Settings, Removal templates (Q10): the working facility's default Removal
 * template and the decision on each of its components. Removal readiness
 * blockers link here, so every member can read which components block a
 * Removal; only Owners and Admins decide them.
 *
 * `?template=` narrows the pane to one template, even one no facility default
 * or credit batch uses yet (the credit batch template switch links that way).
 */
"use client";

import { useQueryState } from "nuqs";
import { RemovalTemplateReviewPanel } from "@/components/certification/removal-template-review-panel";
import { SelectFacilityEmptyState } from "@/components/navigation";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { REMOVAL_TEMPLATES_TEMPLATE_PARAM } from "@/lib/certification/links";
import type { SettingsViewer } from "@/lib/settings/panes";

export function RemovalTemplatesSettingsPane({ viewer }: { viewer: SettingsViewer }) {
  const { facilityId } = useFacilityContext();
  const [requestedTemplate] = useQueryState(REMOVAL_TEMPLATES_TEMPLATE_PARAM);

  if (!facilityId) {
    return (
      <SelectFacilityEmptyState description="Choose a facility from the sidebar to review its Removal templates." />
    );
  }

  return (
    <RemovalTemplateReviewPanel
      key={`removal-template-review-${facilityId}`}
      facilityId={facilityId}
      canManage={viewer.canManage}
      templateId={requestedTemplate}
    />
  );
}
