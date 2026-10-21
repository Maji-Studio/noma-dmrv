/**
 * Certification registry guard
 *
 * Certification is a conditional workspace (ADR 0007): its operational routes
 * (Removals, GHG Statements, plus legacy root redirects) are only reachable
 * once the current facility is linked to a registry. This guard mirrors the
 * sidebar's nav-hiding (`sidebar-content.tsx`) for direct URL access: without a
 * link it redirects to Settings, Registry, which says what connecting unlocks
 * and points on to the facility's project link.
 */
"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { useFacilityCertifierSummary } from "@/hooks/use-certification";
import { registrySettingsHref } from "@/lib/certification/links";

// The retired settings route redirects server-side; the guard lets it through
// so that redirect, not this one, decides where an old link lands.
const LEGACY_SETTINGS_PATH = "/certification/settings";

export function CertificationRegistryGuard({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { facilityId } = useFacilityContext();
  const { data, isLoading } = useFacilityCertifierSummary(
    facilityId ?? "",
    !!facilityId,
  );

  const onSettings =
    pathname === LEGACY_SETTINGS_PATH ||
    pathname.startsWith(`${LEGACY_SETTINGS_PATH}/`);
  // Only guard once a facility is selected; Settings is always allowed through.
  const guarded = !onSettings && !!facilityId;
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
