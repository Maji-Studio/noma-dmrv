/**
 * CertificationSettings
 * The consolidated home for everything that configures how a facility's
 * submissions reach the registry — previously scattered across the facility
 * side-sheet (project link) and /admin/emission-estimates (LCA config), plus
 * the formerly-invisible env/credential posture.
 *
 * All three areas now live on a single stacked page (no tabs) so nothing hides
 * behind a near-empty sub-tab:
 *
 *   Registry credentials — Isometric (org Owners/Admins manage)
 *   Registry connection — Isometric  (everyone reads; org Owners/Admins manage)
 *   Emission estimates               (org Owners/Admins — ADR 0001/0015)
 *   Environment & health             (platform admin only — read-only)
 *
 * Provider-neutral shell (Decision #1): a future registry slots in beside the
 * connection section. Facility comes from context (never a per-form picker).
 * Management capability comes from the server-returned facility summary. The
 * health panel remains a platform-admin surface.
 */
"use client";

import {
  FactoryIcon,
  GaugeIcon,
  KeyIcon,
  PlugsIcon,
  PulseIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { ElementType, ReactNode } from "react";
import { EmissionEstimatesForm } from "@/components/admin/emission-estimates-form";
import { OrganizationCertifierCredentials } from "@/components/organizations/organization-certifier-credentials";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { useActiveOrganizationProfile } from "@/hooks/use-organizations";
import { useFacilityCertifierSummary } from "@/hooks/use-certification";
import { CertificationHealthPanel } from "./certification-health-panel";
import { EnvBanner } from "./env-banner";
import { FacilityCertifierSection } from "./facility-certifier-section";

function SettingsSection({
  icon: Icon,
  title,
  caption,
  children,
}: {
  icon: ElementType;
  title: string;
  caption: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-24 border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-24">
      <div className="flex items-center gap-12 border-b border-[var(--color-border-tertiary)] pb-16">
        <span className="flex size-32 items-center justify-center border border-[var(--color-border-tertiary)] text-[var(--color-text-primary)]">
          <Icon size={18} weight="bold" />
        </span>
        <div className="flex flex-col gap-2">
          <h2 className="title-heading-3">{title}</h2>
          <p className="body-caption text-[var(--color-text-tertiary)]">
            {caption}
          </p>
        </div>
      </div>
      {children}
    </section>
  );
}

export function CertificationSettings() {
  const { facilityId, selectedFacility } = useFacilityContext();
  const isAdmin = useIsAdmin();
  const { data: organization } = useActiveOrganizationProfile();

  // DB-only summary — no Isometric API. Provides the page EnvBanner's
  // environment and the emissions section's prefill mapping without pulling the
  // management payload (the connection section fetches that itself, only when
  // the viewer can manage).
  const { data: summary, isLoading: summaryLoading } =
    useFacilityCertifierSummary(facilityId ?? "", !!facilityId);
  const viewerCanManage = summary?.viewerCanManage ?? false;

  return (
    <div className="container-max page-shell">
      <header className="flex flex-col gap-8">
        <span className="title-chapter-title text-[var(--color-text-tertiary)]">
          Certification
        </span>
        <h1 className="title-heading-2">Settings</h1>
        <p className="body-medium text-[var(--color-text-secondary)] max-w-[680px]">
          Configure how this facility&apos;s removals and GHG statements reach
          the registry — the project link, emission estimates, and the
          integration environment.
        </p>
        {selectedFacility && (
          <div className="flex items-center gap-8 pt-4">
            <span className="title-chapter-title text-[var(--color-text-tertiary)]">
              Settings for
            </span>
            <span className="body-small text-[var(--color-text-primary)]">
              {selectedFacility.code} — {selectedFacility.name}
            </span>
          </div>
        )}
      </header>

      {!facilityId ? (
        <div className="flex flex-col items-center justify-center gap-16 border border-dashed border-[var(--color-border-secondary)] bg-[var(--color-background-white)] py-56">
          <FactoryIcon size={48} className="text-[var(--color-text-tertiary)]" />
          <div className="text-center">
            <h3 className="title-heading-3 mb-8">Select a facility</h3>
            <p className="body-small text-[var(--color-text-secondary)]">
              Choose a facility from the sidebar to configure its certification
              settings.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-24">
          <EnvBanner
            isProduction={summary?.isProduction ?? false}
            isLoading={summaryLoading || !summary}
          />

          {viewerCanManage && organization && (
            <SettingsSection
              icon={KeyIcon}
              title="Registry credentials — Isometric"
              caption="Write-only organization credentials used to connect to Isometric."
            >
              <OrganizationCertifierCredentials
                organizationId={organization.id}
                organizationName={organization.name ?? "your organization"}
              />
            </SettingsSection>
          )}

          {/* Registry connection — everyone reads; org Owners/Admins manage. */}
          <SettingsSection
            icon={PlugsIcon}
            title="Registry connection — Isometric"
            caption="The Isometric project that every removal and GHG statement from this facility targets."
          >
            <FacilityCertifierSection
              key={`facility-certifier-${facilityId}`}
              facilityId={facilityId}
              canManage={viewerCanManage}
              embedded
            />
          </SettingsSection>

          {/* Emission estimates — org Owner/Admin only (ADR 0001/0015).
              EmissionEstimatesForm seeds its RHF defaultValues from `mapping`
              at mount, so it must not mount until the summary has loaded —
              otherwise saved values render blank. */}
          {viewerCanManage && (
            <SettingsSection
              icon={GaugeIcon}
              title="Emission estimates"
              caption="Reference soil temperature for 200-year durability removals."
            >
              {summaryLoading ? (
                <p className="body-medium text-[var(--color-text-tertiary)]">
                  Loading facility configuration…
                </p>
              ) : !summary ? (
                <p className="body-medium text-[var(--clr-red)]" role="alert">
                  Couldn&apos;t load facility configuration. Refresh the page to
                  retry.
                </p>
              ) : (
                <EmissionEstimatesForm
                  key={`emission-estimates-${facilityId}`}
                  facilityId={facilityId}
                  mapping={summary.mapping ?? null}
                  durabilityOption={
                    selectedFacility?.durabilityOption ?? "1000_year"
                  }
                />
              )}
            </SettingsSection>
          )}

          {/* Integration diagnostics — admin only, read-only, no secrets.
              Collapsed by default: credentials health and allowlists are
              diagnostics, not operator configuration — on the first layer they
              crowd out the one thing an operator came here to fix
              (QA 2026-07-21 F5). */}
          {isAdmin && (
            <details className="group border border-[var(--color-border-secondary)] bg-[var(--color-background-white)]">
              <summary className="flex cursor-pointer list-none items-center gap-12 p-24 [&::-webkit-details-marker]:hidden">
                <span className="flex size-32 items-center justify-center border border-[var(--color-border-tertiary)] text-[var(--color-text-primary)]">
                  <PulseIcon size={18} weight="bold" />
                </span>
                <div className="flex flex-col gap-2">
                  <h2 className="title-heading-3">Integration diagnostics</h2>
                  <p className="body-caption text-[var(--color-text-tertiary)]">
                    Read-only environment, credentials, and allowlist status.
                    Never exposes tokens or secrets.
                  </p>
                </div>
                <span className="ml-auto body-caption text-[var(--color-text-tertiary)] group-open:hidden">
                  Show
                </span>
                <span className="ml-auto hidden body-caption text-[var(--color-text-tertiary)] group-open:inline">
                  Hide
                </span>
              </summary>
              <div className="border-t border-[var(--color-border-tertiary)] p-24">
                <CertificationHealthPanel />
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
