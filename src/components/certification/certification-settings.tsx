/**
 * CertificationSettings
 * The consolidated home for everything that configures how a facility's
 * submissions reach the registry — previously scattered across the facility
 * side-sheet (project link) and /admin/emission-estimates (LCA config), plus
 * the formerly-invisible env/credential posture.
 *
 * The three areas live behind tabs (deep-linkable via `?tab=`, matching the
 * `?step=` / `?area=` convention elsewhere):
 *
 *   connection  · Registry connection — Isometric  (everyone reads; admins manage)
 *   emissions   · Emission / LCA config            (admin only — ADR 0005, import-only)
 *   environment · Environment & health             (admin only — read-only, no secrets)
 *
 * Provider-neutral shell (Decision #1): a future registry slots in beside the
 * connection tab. Facility comes from context (never a per-form picker). The
 * emissions/environment tabs are gated client-side on role via `useIsAdmin()`
 * — a UX gate only; the layout is NEVER `requireAdmin`-ed (operators use the
 * hubs), and every privileged action is `requireAdminAction`-guarded
 * server-side. A non-admin who deep-links to an admin tab falls back to
 * `connection`.
 */
"use client";

import {
  Factory,
  Gauge,
  Plugs,
  Pulse,
} from "@phosphor-icons/react/dist/ssr";
import { parseAsStringEnum, useQueryState } from "nuqs";
import type { ElementType, ReactNode } from "react";
import { EmissionEstimatesForm } from "@/components/admin/emission-estimates-form";
import { PeriodEmissionsSection } from "@/components/admin/period-emissions-section";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { useFacilityCertifierSummary } from "@/hooks/use-certification";
import { CertificationHealthPanel } from "./certification-health-panel";
import { EnvBanner } from "./env-banner";
import { FacilityCertifierSection } from "./facility-certifier-section";
import { ProjectEmissionsDriftPanel } from "./project-emissions-drift-panel";

const TAB_KEYS = ["connection", "emissions", "environment"] as const;
type TabKey = (typeof TAB_KEYS)[number];

const TABS: {
  key: TabKey;
  label: string;
  icon: ElementType;
  adminOnly: boolean;
}[] = [
  { key: "connection", label: "Connection", icon: Plugs, adminOnly: false },
  { key: "emissions", label: "Emissions", icon: Gauge, adminOnly: true },
  { key: "environment", label: "Environment", icon: Pulse, adminOnly: true },
];

function getTabId(key: TabKey) {
  return `certification-settings-tab-${key}`;
}

function getPanelId(key: TabKey) {
  return `certification-settings-panel-${key}`;
}

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

function SettingsTabs({
  tabs,
  active,
  onSelect,
}: {
  tabs: typeof TABS;
  active: TabKey;
  onSelect: (key: TabKey) => void;
}) {
  return (
    <div
      className="flex gap-0 overflow-x-auto border-b border-[var(--color-border-secondary)]"
      role="tablist"
    >
      {tabs.map(({ key, label, icon: Icon }) => {
        const isActive = key === active;
        return (
          <button
            key={key}
            type="button"
            id={getTabId(key)}
            role="tab"
            aria-selected={isActive ? "true" : "false"}
            aria-controls={getPanelId(key)}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onSelect(key)}
            className="flex shrink-0 items-center gap-8 h-[48px] px-16 label-button transition-colors cursor-pointer"
            style={{
              color: isActive
                ? "var(--color-text-primary)"
                : "var(--color-text-secondary)",
              borderBottom: isActive
                ? "2px solid var(--color-text-primary)"
                : "2px solid transparent",
              background: isActive
                ? "var(--color-background-white)"
                : "transparent",
            }}
          >
            <Icon size={16} weight="bold" />
            {label}
          </button>
        );
      })}
    </div>
  );
}

export function CertificationSettings() {
  const { facilityId, selectedFacility } = useFacilityContext();
  const isAdmin = useIsAdmin();

  // DB-only summary — no Isometric API. Provides the page EnvBanner's
  // environment and the emissions tab's prefill mapping without pulling the
  // management payload (the connection tab fetches that itself, only when the
  // viewer can manage).
  const {
    data: summary,
    isLoading: summaryLoading,
  } = useFacilityCertifierSummary(facilityId ?? "", !!facilityId);

  const [tab, setTab] = useQueryState(
    "tab",
    parseAsStringEnum<TabKey>([...TAB_KEYS])
      .withDefault("connection")
      .withOptions({ shallow: true, history: "replace" }),
  );

  // Only show admin tabs to admins; a non-admin deep-linking to one falls back
  // to `connection`. `isAdmin` is false until hydration, so the admin tabs
  // appear once the session resolves — matching the rest of the page's gating.
  const visibleTabs = TABS.filter((t) => !t.adminOnly || isAdmin);
  const activeTab = visibleTabs.some((t) => t.key === tab) ? tab : "connection";

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
        <div className="flex flex-col gap-24">
          <EnvBanner
            isProduction={summary?.isProduction ?? false}
            isLoading={summaryLoading || !summary}
          />

          <SettingsTabs
            tabs={visibleTabs}
            active={activeTab}
            onSelect={setTab}
          />

          {/* Registry connection — Isometric (everyone reads; admins manage) */}
          {activeTab === "connection" && (
            <div
              id={getPanelId("connection")}
              role="tabpanel"
              aria-labelledby={getTabId("connection")}
            >
              <SettingsSection
                icon={Plugs}
                title="Registry connection — Isometric"
                caption="The Isometric project that every removal and GHG statement from this facility targets."
              >
                <FacilityCertifierSection
                  key={`facility-certifier-${facilityId}`}
                  facilityId={facilityId}
                  canManage={isAdmin}
                  embedded
                />
              </SettingsSection>
            </div>
          )}

          {/* Emission / LCA config — admin only (ADR 0005, import-only).
              EmissionEstimatesForm seeds its RHF defaultValues from `mapping`
              at mount, so it must not mount until the summary has loaded —
              otherwise saved genset/stage-split values render blank. */}
          {activeTab === "emissions" && isAdmin && (
            <div
              id={getPanelId("emissions")}
              role="tabpanel"
              aria-labelledby={getTabId("emissions")}
            >
              <SettingsSection
                icon={Gauge}
                title="Emission estimates"
                caption="Genset yield + process-stage energy split, and the per-period LCA journal. Feed the per-stage energy datapoints on submission."
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
                  />
                )}
                {/* What's drifted vs. the registry (read-only) sits directly
                    above the journal where the operator records the matching
                    rows — the Overview only shows the one-line summary. */}
                <ProjectEmissionsDriftPanel />
                <PeriodEmissionsSection
                  key={`period-emissions-${facilityId}`}
                  facilityId={facilityId}
                />
              </SettingsSection>
            </div>
          )}

          {/* Environment & health — admin only, read-only, no secrets */}
          {activeTab === "environment" && isAdmin && (
            <div
              id={getPanelId("environment")}
              role="tabpanel"
              aria-labelledby={getTabId("environment")}
            >
              <SettingsSection
                icon={Pulse}
                title="Environment & health"
                caption="Read-only integration status. Never exposes tokens or secrets."
              >
                <CertificationHealthPanel />
              </SettingsSection>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
