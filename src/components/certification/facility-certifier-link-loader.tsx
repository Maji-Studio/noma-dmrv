/**
 * FacilityCertifierLinkLoader
 * Fetches a facility's certifier mapping payload, then renders the shared
 * FacilityCertifierDialog. Lets a flow open the link dialog by facility id
 * alone (e.g. right after creating a facility) without owning the loader.
 *
 * Optional by design: closing the dialog leaves the facility unlinked, which
 * the registry gating already handles — the link can be added later in
 * Certification → Settings.
 */
"use client";

import { useFacilityCertifierMapping } from "@/hooks/use-certification";
import { FacilityCertifierDialog } from "./facility-certifier-dialog";

interface FacilityCertifierLinkLoaderProps {
  facilityId: string;
  isOpen: boolean;
  onClose: () => void;
}

export function FacilityCertifierLinkLoader({
  facilityId,
  isOpen,
  onClose,
}: FacilityCertifierLinkLoaderProps) {
  // Only fetch while open. For a freshly-created facility this also pulls the
  // available Isometric projects, so the dialog opens once the payload lands.
  const { data, isLoading } = useFacilityCertifierMapping(facilityId, isOpen);

  if (!isOpen || isLoading || !data) return null;

  return (
    <FacilityCertifierDialog
      isOpen={isOpen}
      onClose={onClose}
      facilityId={facilityId}
      loaderData={data}
    />
  );
}
