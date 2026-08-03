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
 *
 * While a deep-linked `?facility=` is still being resolved against the active
 * organization (issue #473), the gate renders a loading skeleton instead of
 * the empty state — the selection is pending, not absent. This must live HERE
 * rather than as a layout-level wrapper around `{children}`: interposing a
 * client component between the (app) layout and the streamed page segment
 * breaks Next's Router hydration when a page-level redirect() streams in
 * ("Rendered more hooks than during the previous render", reproduced by
 * tests/e2e/credit-batch-facility-scope.spec.ts).
 */
"use client";

import { BuildingsIcon } from "@phosphor-icons/react/dist/ssr";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { useFacilityContext } from "@/hooks/use-facility-context";

const ICON_SIZE = 48;
const SKELETON_ROW_COUNT = 4;

export interface SelectFacilityEmptyStateProps {
  /**
   * One-line, active-voice guidance completing "…to view its <thing>."
   * Direct the user to the sidebar facility selector.
   */
  description: string;
}

function FacilityResolvingState() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true">
      <Skeleton className="h-[28px]" width="240px" />
      <Skeleton className="h-[16px]" width="360px" />
      {Array.from({ length: SKELETON_ROW_COUNT }).map((_, index) => (
        <Skeleton key={index} className="h-[48px]" />
      ))}
    </div>
  );
}

export function SelectFacilityEmptyState({
  description,
}: SelectFacilityEmptyStateProps) {
  const { isResolving } = useFacilityContext();

  if (isResolving) {
    return <FacilityResolvingState />;
  }

  return (
    <EmptyState
      icon={<BuildingsIcon size={ICON_SIZE} />}
      title="Select a facility"
      description={description}
    />
  );
}
