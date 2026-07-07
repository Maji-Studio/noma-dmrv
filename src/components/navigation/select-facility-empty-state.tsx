/**
 * SelectFacilityEmptyState
 *
 * The single, shared "Select a facility" gate for facility-scoped list pages.
 * A thin wrapper over {@link EmptyState} that standardises the icon and title
 * so every first-run / no-facility screen speaks with one voice; each page
 * supplies only a one-line, active-voice `description` pointing at the sidebar
 * facility selector (e.g. "Choose a facility from the sidebar to view its
 * production runs."). Render it after the page's own PageHeader so the page
 * still identifies itself, and after all hook calls (rules-of-hooks).
 */
"use client";

import { BuildingsIcon } from "@phosphor-icons/react";
import { EmptyState } from "@/components/ui/empty-state";

const ICON_SIZE = 48;

export interface SelectFacilityEmptyStateProps {
  /**
   * One-line, active-voice guidance completing "…to view its <thing>."
   * Direct the user to the sidebar facility selector.
   */
  description: string;
}

export function SelectFacilityEmptyState({
  description,
}: SelectFacilityEmptyStateProps) {
  return (
    <EmptyState
      icon={<BuildingsIcon size={ICON_SIZE} />}
      title="Select a facility"
      description={description}
    />
  );
}
