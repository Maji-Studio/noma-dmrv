/**
 * Settings, Registry: which registry the organization certifies with and its
 * status, the organization-wide keys, the Source visibility policy, and the
 * protocol versions noma is built against.
 *
 * With no keys saved the keys form comes straight after the status, and one
 * line says what saving them unlocks: Removal templates and Facilities stay out
 * of the rail until then (Q11). With keys saved and the working facility not
 * yet linked, a notice points on to Facilities, where the link is made; the
 * registry guard sends unlinked facilities here.
 */
"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { OrganizationCertifierCredentials } from "@/components/organizations/organization-certifier-credentials";
import { ProtocolsInUse } from "@/components/certification/protocols-in-use";
import { RegistrySourceVisibilitySettings } from "@/components/certification/registry-source-visibility-settings";
import {
  RegistryStatusLine,
  REGISTRY_NAME,
  useRegistryConnectionStatus,
} from "@/components/certification/registry-status-line";
import { Notice } from "@/components/ui/notice";
import { useFacilityCertifierSummary } from "@/hooks/use-certification";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { facilityCertificationSettingsHref } from "@/lib/certification/links";
import type { SettingsViewer } from "@/lib/settings/panes";

export const REGISTRY_UNLOCKS_TEXT = `Saving the ${REGISTRY_NAME} keys unlocks Removal templates and Facilities, where each facility is linked to its ${REGISTRY_NAME} project.`;

function PaneSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-12 border-t-[1px] border-[var(--clr-dark-purple-10)] pt-16">
      <h3 className="body-caption text-[var(--color-text-tertiary)]">{title}</h3>
      {children}
    </section>
  );
}

export function RegistrySettingsPane({ viewer }: { viewer: SettingsViewer }) {
  const { facilityId, selectedFacility } = useFacilityContext();
  const status = useRegistryConnectionStatus({
    organizationId: viewer.organizationId,
    facilityId,
    canManage: viewer.canManage,
    keysSavedFallback: viewer.registryKeysSaved,
  });
  const { data: summary } = useFacilityCertifierSummary(facilityId ?? "", !!facilityId);
  const keysSaved = status !== null && status !== "keys-not-saved";
  const facilityLabel = selectedFacility?.name?.trim() || selectedFacility?.code;

  return (
    <div className="flex flex-col gap-24">
      <div className="flex flex-col gap-12">
        <RegistryStatusLine status={status} canManage={viewer.canManage} />
        {status === "keys-not-saved" && (
          <p className="body-small text-[var(--color-text-secondary)]">{REGISTRY_UNLOCKS_TEXT}</p>
        )}
        {keysSaved && facilityId && summary && !summary.mapping && (
          <Notice
            tone="warning"
            action={
              <Link
                href={facilityCertificationSettingsHref(facilityId)}
                className="body-small font-medium underline underline-offset-2"
              >
                Open Facilities
              </Link>
            }
          >
            {facilityLabel ?? "This facility"} has no {REGISTRY_NAME} project link. Link it in Facilities before submitting.
          </Notice>
        )}
      </div>

      {viewer.canManage && (
        <PaneSection title={`${REGISTRY_NAME} keys`}>
          <OrganizationCertifierCredentials
            organizationId={viewer.organizationId}
            organizationName={viewer.organizationName}
          />
        </PaneSection>
      )}

      <PaneSection title="Source visibility">
        <RegistrySourceVisibilitySettings />
      </PaneSection>

      <ProtocolsInUse />
    </div>
  );
}
