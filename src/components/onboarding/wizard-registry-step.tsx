/**
 * WizardRegistryStep — the wizard's "connect your registry" step.
 *
 * It renders the same `CertifierSettingsPanel` that `/certification/settings`
 * does, so the surface an operator meets on day one is the surface they return
 * to. It used to compose the registry picker, the credentials form, and the
 * facility link itself, which meant the two places drifted: the wizard kept the
 * project link in a hand-rolled card long after settings stopped using one.
 *
 * The step is skippable — the getting-started guide re-surfaces it later.
 */
"use client";

import { CertifierSettingsPanel } from "@/components/certification";

interface WizardRegistryStepProps {
  facilityId: string;
  canManage: boolean;
}

export function WizardRegistryStep({
  facilityId,
  canManage,
}: WizardRegistryStepProps) {
  return (
    <div className="flex flex-col gap-24">
      <p className="body-small text-[var(--color-text-secondary)]">
        {canManage
          ? "Isometric is your registry. Save the organization's keys, then link this facility to its Isometric project. You can skip this and connect later."
          : "Isometric is your registry. The Maji platform team helps set up the connection. Once it is live, this facility's project link appears here. You can skip this step and continue."}
      </p>

      <CertifierSettingsPanel
        facilityId={facilityId}
        canManage={canManage}
        projectLinkPresentation="inline"
      />
    </div>
  );
}
