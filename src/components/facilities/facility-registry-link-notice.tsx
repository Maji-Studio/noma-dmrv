/**
 * Shown on the facility list after a create, for a viewer who may link the new
 * facility to its registry project. The link is made in Settings, Facilities,
 * the one place it lives (#1277); the link carries the new facility in
 * `?facility=`, which also makes it the working facility there. The toast
 * already confirmed the create, so this is information with a next step, and
 * it can be dismissed.
 */
"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { useFacilityCertifierSummary } from "@/hooks/use-certification";
import { facilityCertificationSettingsHref } from "@/lib/certification/links";

export function FacilityRegistryLinkNotice({
  facility,
  onDismiss,
}: {
  facility: { id: string; code: string };
  onDismiss: () => void;
}) {
  const { data: summary } = useFacilityCertifierSummary(facility.id);
  if (!summary?.viewerCanManage || summary.mapping) return null;

  return (
    <Notice
      tone="info"
      action={
        <span className="flex flex-wrap items-center gap-x-16 gap-y-4">
          <Link
            href={facilityCertificationSettingsHref(facility.id)}
            className="body-small inline-flex min-h-44 items-center font-medium underline underline-offset-2 md:min-h-0"
          >
            Link registry project
          </Link>
          <Button type="button" variant="noOutline" size="small" className="min-h-44 md:min-h-0" onClick={onDismiss}>
            Dismiss
          </Button>
        </span>
      }
    >
      {facility.code} is not linked to an Isometric project yet. Link it before submitting from it.
    </Notice>
  );
}
