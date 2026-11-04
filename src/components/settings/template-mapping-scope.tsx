"use client";

import { FactoryIcon } from "@phosphor-icons/react/dist/ssr";
import { useViewerOrg } from "@/components/navigation";
import { useFacilityContext } from "@/hooks/use-facility-context";

/**
 * Says whose template mapping the Platform page shows: the sidebar's working
 * facility, in the organization you are working in. Platform pages hide the
 * Platform Admin bar, so without this line nothing on the page would name
 * either (#1373).
 */
export function TemplateMappingScope() {
  const organizationName = useViewerOrg()?.organizationName;
  const facilityName = useFacilityContext().selectedFacility?.name;
  if (!organizationName) return null;
  return (
    <p className="body-small flex items-center gap-8 text-[var(--color-text-secondary)]">
      <FactoryIcon size={16} className="shrink-0 text-[var(--color-icon-secondary)]" aria-hidden />
      {facilityName ? `${facilityName} in ${organizationName}` : `No facility selected in ${organizationName}`}
      <span className="text-[var(--color-text-tertiary)]">Change it with the facility selector.</span>
    </p>
  );
}
