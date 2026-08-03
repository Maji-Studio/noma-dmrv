/**
 * CertifierSettingsPanel — the whole registry connection on one pane.
 *
 * Credentials and the facility's project link used to be two categories in the
 * rail, then two titled blocks in one pane. Both splits told the same lie: that
 * these are separate jobs. They are one — keys are useless until a project is
 * linked, and a project cannot be listed until the keys work — so the pane now
 * reads straight down: which registry, its keys, then which project this
 * facility submits to, with the link control in the same run of controls.
 *
 * The pane sits under the Organization tier because the certifier and its keys
 * are organization-wide. The project link is per facility; the pane caption in
 * `certification-settings.tsx` says so.
 *
 * Members see the registry and the read-only project link; the keys form is
 * mounted only for a viewer the server says can manage it.
 */
"use client";

import { OrganizationCertifierCredentials } from "@/components/organizations/organization-certifier-credentials";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { useActiveOrganizationProfile } from "@/hooks/use-organizations";
import { FacilityCertifierSection } from "./facility-certifier-section";
import { RegistryPicker } from "./registry-picker";

interface CertifierSettingsPanelProps {
  facilityId: string;
  /** Facility code, for the project-link lead-in. */
  facilityLabel?: string;
  /** Server-computed. Gates the keys form and the link controls together. */
  canManage: boolean;
  /** Inline avoids opening a project-link dialog inside an existing modal. */
  projectLinkPresentation?: "dialog" | "inline";
}

export function CertifierSettingsPanel({
  facilityId,
  facilityLabel,
  canManage,
  projectLinkPresentation = "dialog",
}: CertifierSettingsPanelProps) {
  const { data: organization, isLoading } = useActiveOrganizationProfile();

  return (
    <div className="flex flex-col gap-24">
      <RegistryPicker />

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
        />
      </div>
    </div>
  );
}
