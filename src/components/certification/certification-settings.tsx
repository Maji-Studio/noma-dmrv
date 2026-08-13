/**
 * CertificationSettings
 *
 * Everything that configures how a facility's submissions reach the registry:
 * organization credentials and Source visibility policy, the facility's project
 * link, its soil reference values, and the read-only integration diagnostics.
 *
 * Registry configuration stays on this route by ADR 0007 — only the shape
 * changes here. The page was a single stacked column of five sections, which
 * made two things hard to see: which tier a setting applied to (organization or
 * facility), and that the "Emission estimates" section rendered for nobody on a
 * default deployment because it was gated on the 200-year durability tier that
 * ADR 0021 leaves unavailable.
 *
 * It is now a console — a category rail plus a detail pane:
 *
 *   ORGANIZATION   Certifier · Sources
 *   FACILITY       Emissions
 *   PLATFORM       Diagnostics · Template mapping  (platform admin only)
 *
 * Three consequences of that shape worth knowing before editing:
 *
 * 1. Only the selected section is mounted, so a URL fragment cannot reach a
 *    section. Deep links use `?section=` (see `@/lib/certification/links`), and
 *    the section keys there are load-bearing.
 * 2. Credentials and the facility's project link were two categories and are
 *    now one Certifier pane: keys are useless without a linked project, and a
 *    project cannot be listed before the keys work, so splitting them made one
 *    job take two clicks in a fixed order the rail did not express. The old
 *    `?section=connection` still resolves here.
 * 3. The Emissions category is always listed for anyone who can manage it, and
 *    explains itself as "Not used" off the 200-year tier rather than vanishing.
 *    A fix link that lands on an empty page is worse than one that lands on a
 *    sentence saying why there is nothing to set.
 *
 * Diagnostics used to be a collapsed `<details>` so it could not crowd out the
 * thing an operator came to fix (QA 2026-07-21 F5). A rail entry satisfies that
 * finding more directly: it is not on the first layer at all.
 *
 * Provider-neutral: a second registry becomes more sections under the same
 * tiers. Facility comes from context, never a per-form picker; management
 * capability comes from the server-computed `viewerCanManage`.
 */
"use client";

import type { ReactNode } from "react";
import { parseAsString, useQueryState } from "nuqs";
import {
  GaugeIcon,
  GlobeIcon,
  PlugsIcon,
  PulseIcon,
  TreeStructureIcon,
} from "@phosphor-icons/react/dist/ssr";
import { EmissionEstimatesForm } from "@/components/admin/emission-estimates-form";
import { SelectFacilityEmptyState } from "@/components/navigation";
import { SETTINGS_CONSOLE_MAX_WIDTH_CLASS } from "@/components/settings/settings-console";
import { PageHeader } from "@/components/ui";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { useActiveOrganizationProfile } from "@/hooks/use-organizations";
import { useFacilityCertifierSummary } from "@/hooks/use-certification";
import { useOrgCertifierCredentialsStatus } from "@/hooks/use-certifier-credentials";
import {
  CERTIFICATION_SETTINGS_CERTIFIER_SECTION,
  CERTIFICATION_SETTINGS_DIAGNOSTICS_SECTION,
  CERTIFICATION_SETTINGS_EMISSIONS_SECTION,
  CERTIFICATION_SETTINGS_LEGACY_CONNECTION_SECTION,
  CERTIFICATION_SETTINGS_SECTION_PARAM,
  CERTIFICATION_SETTINGS_SOURCES_SECTION,
  CERTIFICATION_SETTINGS_TEMPLATE_MAPPING_SECTION,
} from "@/lib/certification/links";
import { CertificationHealthPanel } from "./certification-health-panel";
import { CertifierSettingsPanel } from "./certifier-settings-panel";
import { EnvBanner } from "./env-banner";
import { RegistrySourceVisibilitySettings } from "./registry-source-visibility-settings";
import { SettingsRail, type SettingsSectionMeta } from "@/components/ui";
import { RemovalTemplateDiagnosticPanel } from "./removal-template-diagnostic-panel";

const SECTION_CERTIFIER = CERTIFICATION_SETTINGS_CERTIFIER_SECTION;
const SECTION_SOURCES = CERTIFICATION_SETTINGS_SOURCES_SECTION;
const SECTION_EMISSIONS = CERTIFICATION_SETTINGS_EMISSIONS_SECTION;
const SECTION_DIAGNOSTICS = CERTIFICATION_SETTINGS_DIAGNOSTICS_SECTION;
const SECTION_TEMPLATE_MAPPING =
  CERTIFICATION_SETTINGS_TEMPLATE_MAPPING_SECTION;

/** Section keys that were retired, mapped to the pane that absorbed them. */
const LEGACY_SECTION_KEYS: Record<string, string> = {
  [CERTIFICATION_SETTINGS_LEGACY_CONNECTION_SECTION]: SECTION_CERTIFIER,
  credentials: SECTION_CERTIFIER,
};

/** The durability tier the soil reference values are configuration for. */
const SOIL_MODELLED_TIER = "200_year";

interface ConsoleSection extends SettingsSectionMeta {
  /** Pane header. The rail label is one word; this line explains it. */
  caption: string;
  /** Who may change what is in this pane, for the pane footnote. */
  access: string;
  readOnly?: boolean;
  content: ReactNode;
}

/**
 * Explains a category that is present but has nothing to set, in place of the
 * form. The "Not used" marker is one of only two markers the settings work kept
 * (the other is "Required"): it changes what you do next by telling you not to
 * go looking for a control.
 */
function NotUsedNotice({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-10">
      <div className="flex items-center gap-8">
        <span
          aria-hidden
          className="size-6 rounded-full bg-[var(--st-off)]"
        />
        <span className="body-caption text-[var(--st-off)]">Not used</span>
      </div>
      <h3 className="body-medium text-[var(--color-text-primary)]">{title}</h3>
      <p className="body-small max-w-[560px] text-[var(--color-text-secondary)]">
        {children}
      </p>
    </div>
  );
}

export function CertificationSettings() {
  const { facilityId, selectedFacility } = useFacilityContext();
  const isAdmin = useIsAdmin();
  const { data: organization } = useActiveOrganizationProfile();

  // DB-only summary — no Isometric API. Supplies the environment banner, the
  // emissions prefill mapping, and whether this viewer may manage anything,
  // without pulling the heavier management payload (the connection section
  // fetches that itself, and only when the viewer can manage).
  const { data: summary, isLoading: summaryLoading } =
    useFacilityCertifierSummary(facilityId ?? "", !!facilityId);
  const viewerCanManage = summary?.viewerCanManage ?? false;

  // Posture only, for the rail marker. Gated to exactly the condition that
  // mounts the Credentials pane, so no viewer triggers a call they could not
  // already make.
  const canManageCredentials = viewerCanManage && !!organization;
  const { data: credentials } = useOrgCertifierCredentialsStatus(
    organization?.id ?? "",
    canManageCredentials,
  );

  // `?section=` is the single source of truth for the selection, so a deep link
  // and a rail click are the same operation. `shallow` because no section needs
  // a server round-trip, and `replace` because switching category is not a
  // navigation an operator would expect Back to undo.
  const [requestedSection, setRequestedSection] = useQueryState(
    CERTIFICATION_SETTINGS_SECTION_PARAM,
    parseAsString.withOptions({ shallow: true, history: "replace" }),
  );

  const soilTierActive =
    selectedFacility?.durabilityOption === SOIL_MODELLED_TIER;

  const sections: ConsoleSection[] = [];

  // Always listed, for every viewer. A member cannot change the keys or the
  // link, but the pane is where the current state is readable, and it is what
  // the registry-guard's "not connected yet" copy points at.
  sections.push({
    key: SECTION_CERTIFIER,
    tier: "organization",
    label: "Certifier",
    icon: PlugsIcon,
    caption:
      "Your registry, its organization-wide keys, and the project this facility submits to.",
    access: "Owners and Admins",
    // Either half missing blocks every submission from this facility, and both
    // are fixed here, so one marker covers them. `summary` is undefined while
    // loading — wait rather than flash a marker that then disappears.
    needsAttention: summary
      ? !summary.mapping || (canManageCredentials && credentials
          ? !credentials.configured
          : false)
      : false,
    content: facilityId ? (
      <CertifierSettingsPanel
        facilityId={facilityId}
        facilityLabel={selectedFacility?.code}
        canManage={viewerCanManage}
      />
    ) : null,
  });

  sections.push({
    key: SECTION_SOURCES,
    tier: "organization",
    label: "Sources",
    icon: GlobeIcon,
    caption:
      "Whether new Isometric Sources start private to verifiers or public on the registry.",
    access: "Owners and Admins",
    content: <RegistrySourceVisibilitySettings />,
  });

  if (viewerCanManage) {
    sections.push({
      key: SECTION_EMISSIONS,
      tier: "facility",
      label: "Emissions",
      icon: GaugeIcon,
      caption: soilTierActive
        ? "Reference soil temperature for this facility's 200-year durability model."
        : "Soil reference values, used only by the 200-year durability model.",
      access: "Owners and Admins",
      content: !soilTierActive ? (
        // ADR 0021: the tier is declared once per facility and 1000-year is the
        // available one, so on a default deployment this is the state everyone
        // sees. It used to render nothing at all, which made the credit-batch
        // "Open emission estimates" fix link lead to a blank page.
        <NotUsedNotice title="This facility is on the 1000-year durability tier">
          The reference soil temperature only feeds the 200-year model, which
          derives durability from the H:C ratio and soil temperature. The
          1000-year tier measures R₀ reflectance on the Sample instead, so there
          is nothing to configure here. Change the facility&apos;s durability
          tier to make these values apply.
        </NotUsedNotice>
      ) : summaryLoading ? (
        <p className="body-medium text-[var(--color-text-tertiary)]">
          Loading facility configuration…
        </p>
      ) : !summary ? (
        <p className="body-medium text-[var(--clr-red)]" role="alert">
          Couldn&apos;t load facility configuration. Refresh the page to retry.
        </p>
      ) : facilityId ? (
        // EmissionEstimatesForm seeds its RHF defaultValues from `mapping` at
        // mount, so it must not mount before the summary lands — otherwise
        // saved values render blank.
        <EmissionEstimatesForm
          key={`emission-estimates-${facilityId}`}
          facilityId={facilityId}
          mapping={summary.mapping ?? null}
          durabilityOption={SOIL_MODELLED_TIER}
        />
      ) : null,
    });
  }

  if (isAdmin) {
    sections.push({
      key: SECTION_DIAGNOSTICS,
      tier: "platform",
      label: "Diagnostics",
      icon: PulseIcon,
      caption:
        "Read-only environment, credential and allowlist status. Never exposes tokens.",
      access: "Platform Admins",
      content: <CertificationHealthPanel />,
    });
    sections.push({
      key: SECTION_TEMPLATE_MAPPING,
      tier: "platform",
      label: "Template mapping",
      icon: TreeStructureIcon,
      caption:
        "Read-only mapping, lineage, and Removal compilation traces for this facility's active Isometric Removal template.",
      access: "Platform Admins",
      readOnly: true,
      content: facilityId ? (
        <RemovalTemplateDiagnosticPanel facilityId={facilityId} />
      ) : null,
    });
  }

  // Resolve the selection against what this viewer can actually see: a deep
  // link built for an Owner must not leave a member staring at an empty pane,
  // and an unknown `?section=` must not blank the console either. Retired keys
  // resolve to the pane that absorbed them before anything else is tried.
  const resolvedKey = requestedSection
    ? (LEGACY_SECTION_KEYS[requestedSection] ?? requestedSection)
    : null;
  const selected =
    sections.find((s) => s.key === resolvedKey) ??
    sections.find((s) => s.key === SECTION_CERTIFIER) ??
    sections[0];

  const subtitle = selectedFacility
    ? `Configure how ${selectedFacility.code} reaches the registry.`
    : "Configure how this facility's Removals and GHG Statements reach the registry.";

  if (!facilityId) {
    return (
      <div className="container-max page-shell">
        <PageHeader area="certification" title="Settings" subtitle={subtitle} />
        <SelectFacilityEmptyState description="Choose a facility from the sidebar to configure its certification settings." />
      </div>
    );
  }

  return (
    <div className="container-max page-shell">
      <div
        className={`${SETTINGS_CONSOLE_MAX_WIDTH_CLASS} flex flex-col gap-16`}
      >
        <PageHeader area="certification" title="Settings" subtitle={subtitle} />
        {/* Which Isometric environment a write lands in is a property of the
            whole integration, not of one category, so it stays above the rail
            where no selection can hide it. */}
        <EnvBanner
          isProduction={summary?.isProduction ?? false}
          isLoading={summaryLoading || !summary}
        />
      </div>

      <div
        className={`${SETTINGS_CONSOLE_MAX_WIDTH_CLASS} grid gap-24 lg:grid-cols-[236px_minmax(0,1fr)] lg:items-start`}
      >
        <SettingsRail
          sections={sections}
          selectedKey={selected?.key ?? ""}
          onSelect={(key) => void setRequestedSection(key)}
          ariaLabel="Certification settings categories"
          idPrefix="certification-settings"
        />

        {selected && (
          <section className="border-[1.5px] border-[var(--clr-dark-purple-40)] bg-[var(--paper)]">
            {/* Title and caption only. A scope tag here would repeat the rail
                header the selection came from. */}
            <div className="flex flex-col gap-4 border-b-[1px] border-[var(--clr-dark-purple-10)] bg-[var(--sea)] px-24 py-16">
              <h2 className="title-heading-3">{selected.label}</h2>
              <p className="body-caption text-[var(--color-text-tertiary)]">
                {selected.caption}
              </p>
            </div>

            <div className="p-24">{selected.content}</div>

            <div className="border-t-[1px] border-[var(--clr-dark-purple-10)] px-24 py-16">
              <span className="body-caption text-[var(--color-text-tertiary)]">
                {selected.readOnly
                  ? `Read-only for ${selected.access}.`
                  : `${selected.access} can change these.`}
              </span>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
