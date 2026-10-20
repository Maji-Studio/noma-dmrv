/**
 * Shown on the facility list after a create, for a viewer who may link the new
 * facility to its registry project. The link is made in Settings, Facilities,
 * the one place it lives (#1277); the link carries the new facility in
 * `?facility=`, which also makes it the working facility there.
 */
"use client";

import Link from "next/link";
import { Notice } from "@/components/ui/notice";
import { useFacilityCertifierSummary } from "@/hooks/use-certification";
import { facilityCertificationSettingsHref } from "@/lib/certification/links";

export function FacilityRegistryLinkNotice({ facility }: { facility: { id: string; code: string } }) {
  const { data: summary } = useFacilityCertifierSummary(facility.id);
  if (!summary?.viewerCanManage || summary.mapping) return null;

  return (
    <Notice
      tone="success"
      action={
        <Link
          href={facilityCertificationSettingsHref(facility.id)}
          className="body-small font-medium underline underline-offset-2"
        >
          Link registry project
        </Link>
      }
    >
      Facility {facility.code} created. Link it to its Isometric project before submitting from it.
    </Notice>
  );
}
