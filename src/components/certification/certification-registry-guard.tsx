/**
 * Certification registry guard
 *
 * Certification is a conditional workspace (ADR 0007): its operational routes
 * (Removals, GHG Statements, plus legacy root redirects) are only reachable
 * once the current facility is linked to a registry. This guard mirrors the
 * sidebar's nav-hiding (`app-sidebar.tsx`) for direct URL access — without a
 * link it redirects to Settings, the one route that stays open because it's
 * where the link is made.
 */
"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { useFacilityCertifierSummary } from "@/hooks/use-certification";

const SETTINGS_PATH = "/certification/settings";

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
    pathname === SETTINGS_PATH || pathname.startsWith(`${SETTINGS_PATH}/`);
  // Only guard once a facility is selected; Settings is always allowed through.
  const guarded = !onSettings && !!facilityId;
  const hasRegistry = Boolean(data?.mapping);
  const shouldRedirect = guarded && !isLoading && !hasRegistry;

  useEffect(() => {
    if (shouldRedirect && facilityId) {
      router.replace(
        `${SETTINGS_PATH}?facility=${encodeURIComponent(facilityId)}`,
      );
    }
  }, [shouldRedirect, facilityId, router]);

  // On a guarded route, hold rendering until a link is confirmed — otherwise the
  // operational page flashes before the redirect lands.
  if (guarded && (isLoading || !hasRegistry)) {
    return null;
  }

  return <>{children}</>;
}
