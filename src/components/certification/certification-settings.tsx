/**
 * CertificationSettings
 * The consolidated home for everything that configures how a facility's
 * submissions reach the registry — previously scattered across the facility
 * side-sheet (project link) and /admin/emission-estimates (LCA config), plus
 * the formerly-invisible env/credential posture.
 *
 *   A · Registry connection — Isometric  (everyone reads; admins manage)
 *   B · Emission / LCA config            (admin only — ADR 0005, import-only)
 *   C · Environment & health             (admin only — read-only, no secrets)
 *
 * Provider-neutral shell (Decision #1): a future registry slots in beside A.
 * Facility comes from context (never a per-form picker). Sections B/C are
 * gated client-side on role via `useIsAdmin()` — a UX gate only; the layout is
 * NEVER `requireAdmin`-ed (operators use the hubs), and every privileged
 * action is `requireAdminAction`-guarded server-side.
 */
"use client";

import {
  Factory,
  Gauge,
  Plugs,
  Pulse,
} from "@phosphor-icons/react/dist/ssr";
import type { ElementType, ReactNode } from "react";
import { EmissionEstimatesForm } from "@/components/admin/emission-estimates-form";
import { PeriodEmissionsSection } from "@/components/admin/period-emissions-section";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { useIsAdmin } from "@/hooks/use-is-admin";
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

  // DB-only summary — no Isometric API. Provides the page EnvBanner's
  // environment and section B's prefill mapping without pulling the management
  // payload (Section A fetches that itself, only when the viewer can manage).
  const {
    data: summary,
    isLoading: summaryLoading,
  } = useFacilityCertifierSummary(facilityId ?? "", !!facilityId);

  return (
    <div className="container-max flex flex-col gap-32 py-32">
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
          <Factory size={48} className="text-[var(--color-text-tertiary)]" />
          <div className="text-center">
            <h3 className="title-heading-3 mb-8">Select a facility</h3>
            <p className="body-small text-[var(--color-text-secondary)]">
              Choose a facility from the sidebar to configure its certification
              settings.
            </p>
          </div>
        </div>
      ) : (
        <>
          <EnvBanner
            isProduction={summary?.isProduction ?? false}
            isLoading={summaryLoading || !summary}
          />

          {/* A · Registry connection — Isometric */}
          <SettingsSection
            icon={Plugs}
            title="Registry connection — Isometric"
            caption="The Isometric project every removal and GHG statement from this facility targets."
          >
            <FacilityCertifierSection
              key={facilityId}
              facilityId={facilityId}
              canManage={isAdmin}
              embedded
            />
          </SettingsSection>

          {/* B · Emission / LCA config — admin only (ADR 0005, import-only).
              EmissionEstimatesForm seeds its RHF defaultValues from `mapping`
              at mount, so it must not mount until the summary has loaded —
              otherwise saved genset/stage-split values render blank. */}
          {isAdmin && (
            <SettingsSection
              icon={Gauge}
              title="Emission estimates"
              caption="Genset yield + process-stage energy split, and the per-period LCA journal. Feed the per-stage energy datapoints on submission."
            >
              {summaryLoading ? (
                <p className="body-medium text-[var(--color-text-tertiary)]">
                  Loading facility configuration…
                </p>
              ) : (
                <EmissionEstimatesForm
                  key={facilityId}
                  facilityId={facilityId}
                  mapping={summary?.mapping ?? null}
                />
              )}
              <PeriodEmissionsSection key={facilityId} facilityId={facilityId} />
            </SettingsSection>
          )}

          {/* C · Environment & health — admin only, read-only, no secrets */}
          {isAdmin && (
            <SettingsSection
              icon={Pulse}
              title="Environment & health"
              caption="Read-only integration status. Never exposes tokens or secrets."
            >
              <CertificationHealthPanel />
            </SettingsSection>
          )}
        </>
      )}
    </div>
  );
}
