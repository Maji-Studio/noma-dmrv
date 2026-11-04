/**
 * Certification registry guard
 *
 * Certification is a conditional workspace (ADR 0007): its operational routes
 * (`/removals` and `/ghg-statements`) are only reachable
 * once the current facility is linked to a registry. This guard mirrors the
 * sidebar's nav-hiding (`sidebar-content.tsx`) for direct URL access: without a
 * link it redirects to Settings, Registry, which says what connecting unlocks
 * and points on to the facility's project link.
 */
"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { useFacilityCertifierSummary } from "@/hooks/use-certification";
import { registrySettingsHref } from "@/lib/certification/links";

export function CertificationRegistryGuard({
  children,
}: {
  children: ReactNode;
}) {
  const router = useRouter();
  const { facilityId } = useFacilityContext();
  const { data, isLoading } = useFacilityCertifierSummary(
    facilityId ?? "",
    !!facilityId,
  );

  // The route group contains only operational pages; guard once a facility is selected.
  const guarded = !!facilityId;
  const hasRegistry = Boolean(data?.mapping);
  const shouldRedirect = guarded && !isLoading && !hasRegistry;

  useEffect(() => {
    if (shouldRedirect && facilityId) {
      router.replace(registrySettingsHref(facilityId));
    }
  }, [shouldRedirect, facilityId, router]);

  // On a guarded route, hold rendering until a link is confirmed — otherwise the
  // operational page flashes before the redirect lands.
  if (guarded && (isLoading || !hasRegistry)) {
    return null;
  }

  return <>{children}</>;
}
