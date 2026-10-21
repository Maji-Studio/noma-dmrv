/**
 * CertifierSettingsPanel — the whole registry connection in one run, for the
 * dashboard registry dialog: which registry and its status, its keys, then
 * which project this facility submits to, with the link control inline.
 *
 * In Settings the same parts sit on two panes (Registry for the keys,
 * Facilities for the project link), because the console groups by what a
 * setting applies to. The dialog keeps them together because it walks one
 * facility through first setup.
 *
 * Members see the registry and the read-only project link; the keys form is
 * mounted only for a viewer the server says can manage it.
 */
"use client";

import { OrganizationCertifierCredentials } from "@/components/organizations/organization-certifier-credentials";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { useActiveOrganizationProfile } from "@/hooks/use-organizations";
import { FacilityCertifierSection } from "./facility-certifier-section";
import { RegistryStatusLine, useRegistryConnectionStatus } from "./registry-status-line";

interface CertifierSettingsPanelProps {
  facilityId: string;
  /** Facility code, for the project-link lead-in. */
  facilityLabel?: string;
  /** Server-computed. Gates the keys form and the link controls together. */
  canManage: boolean;
  /** Inline avoids opening a project-link dialog inside an existing modal. */
  projectLinkPresentation?: "dialog" | "inline";
  onProjectLinked?: () => void;
}

export function CertifierSettingsPanel({
  facilityId,
  facilityLabel,
  canManage,
  projectLinkPresentation = "dialog",
  onProjectLinked,
}: CertifierSettingsPanelProps) {
  const { data: organization, isLoading } = useActiveOrganizationProfile();
  const status = useRegistryConnectionStatus({
    organizationId: organization?.id,
    facilityId,
    canManage,
  });

  return (
    <div className="flex flex-col gap-24">
      <RegistryStatusLine status={status} canManage={canManage} />

      {canManage &&
        (isLoading ? (
          <Skeleton className="h-160 w-full" />
        ) : organization ? (
          <OrganizationCertifierCredentials
            organizationId={organization.id}
            organizationName={organization.name ?? "your organization"}
          />
        ) : (
          <p className="body-small text-[var(--color-text-secondary)]">
            Couldn&apos;t load your organization, so the keys can&apos;t be
            saved right now. Refresh the page to retry.
          </p>
        ))}

      <div className="flex flex-col gap-12 border-t-[1px] border-[var(--clr-dark-purple-10)] pt-16">
        {/* A label, not a sentence: the pane caption above already says what a
            project link is, so this only has to name which facility's. */}
        <p className="body-caption text-[var(--color-text-tertiary)]">
          {facilityLabel ? `Project link · ${facilityLabel}` : "Project link"}
        </p>
        <FacilityCertifierSection
          key={`facility-certifier-${facilityId}`}
          facilityId={facilityId}
          canManage={canManage}
          embedded
          linkPresentation={projectLinkPresentation}
          onLinked={onProjectLinked}
        />
      </div>
    </div>
  );
}
