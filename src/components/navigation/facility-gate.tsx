/**
 * FacilityGate
 *
 * Wraps the authenticated workspace content and holds it behind a brief loading
 * state while a deep-linked `?facility=` from the URL is still being resolved
 * against the active organization (see {@link FacilityProvider} and issue #473).
 *
 * Without this, direct navigation to a facility-scoped URL momentarily reports
 * no selected facility, so pages flash the "Select a facility" gate before the
 * facility rehydrates. Gating only on the *unresolved deep link* — never on
 * ordinary background loading — keeps facility-agnostic pages (and pages
 * reached without a `?facility=` param) rendering immediately.
 *
 * Membership is still verified server-side by every org-scoped query; this only
 * changes what the operator sees during the resolution window.
 */
"use client";

import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { useFacilityContext } from "@/hooks/use-facility-context";

const KPI_CARD_COUNT = 4;

function FacilityResolvingState() {
  return (
    <div className="container-max page-shell" aria-busy="true">
      <div className="flex flex-col gap-8">
        <Skeleton className="h-[14px]" width="120px" />
        <Skeleton className="h-[28px]" width="240px" />
        <Skeleton className="h-[16px]" width="360px" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-24">
        {Array.from({ length: KPI_CARD_COUNT }).map((_, index) => (
          <Skeleton key={index} className="h-[96px]" />
        ))}
      </div>
      <Skeleton className="h-[320px]" />
    </div>
  );
}

export function FacilityGate({ children }: { children: ReactNode }) {
  const { isResolving } = useFacilityContext();

  if (isResolving) {
    return <FacilityResolvingState />;
  }

  return <>{children}</>;
}
