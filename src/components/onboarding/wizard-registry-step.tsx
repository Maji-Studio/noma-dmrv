/**
 * WizardRegistryStep — the wizard's "connect your registry" step. Composes the
 * existing certification surfaces rather than reimplementing them.
 *
 * Org Owners/Admins and platform admins get the full self-serve credentials
 * and facility-mapping surface. Members get the persisted read-only state.
 * The step is skippable — the getting-started guide re-surfaces it later.
 */
"use client";

import { FacilityCertifierSection } from "@/components/certification";
import { OrganizationCertifierCredentials } from "@/components/organizations/organization-certifier-credentials";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { useActiveOrganizationProfile } from "@/hooks/use-organizations";
import { RegistryPicker } from "./registry-picker";

interface WizardRegistryStepProps {
  facilityId: string;
  canManage: boolean;
}

export function WizardRegistryStep({
  facilityId,
  canManage,
}: WizardRegistryStepProps) {
  const { data: organization, isLoading } = useActiveOrganizationProfile();

  return (
    <div className="flex flex-col gap-24">
      <p className="body-small text-[var(--color-text-secondary)]">
        {canManage
          ? "Isometric is your registry. Add the organization's credentials, then link this facility to its Isometric project. You can skip this and connect later."
          : "Isometric is your registry. The connection is set up together with the Maji platform team — once it's live, this facility's project link appears here. You can skip this step and keep going."}
      </p>

      <RegistryPicker />

      {canManage &&
        (isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : organization ? (
          <OrganizationCertifierCredentials
            organizationId={organization.id}
            organizationName={organization.name ?? "your organization"}
          />
        ) : (
          <p className="body-small text-[var(--color-text-secondary)]">
            Couldn&apos;t load your organization. You can connect your registry
            later from certification settings.
          </p>
        ))}

      <div className="flex flex-col gap-8 border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-16">
        <h3 className="body-small font-medium text-[var(--color-text-primary)]">
          Facility project link
        </h3>
        <FacilityCertifierSection
          key={`wizard-certifier-${facilityId}`}
          facilityId={facilityId}
          canManage={canManage}
          embedded
        />
      </div>
    </div>
  );
}
