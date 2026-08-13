/**
 * The settings page is a category rail plus one detail pane, so these tests are
 * mostly about what is NOT mounted: the pane is the only place a section's form
 * exists, and `?section=` is the only way to reach one.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CertificationSettings } from "./certification-settings";

const facilityState = vi.hoisted(() => ({
  durabilityOption: "200_year" as "200_year" | "1000_year",
}));

const urlState = vi.hoisted(() => ({ section: null as string | null }));
const adminState = vi.hoisted(() => ({ isPlatformAdmin: false }));

const viewerState = vi.hoisted(() => ({
  canManage: true,
  credentialsConfigured: true,
  mapping: null as { externalProjectId: string } | null,
}));

vi.mock("nuqs", () => ({
  parseAsString: {
    withOptions: () => ({ parse: (v: string) => v, serialize: (v: string) => v }),
  },
  useQueryState: () => [urlState.section, vi.fn()],
}));

vi.mock("@/components/admin/emission-estimates-form", () => ({
  EmissionEstimatesForm: () => <div>Emission estimates form</div>,
}));

vi.mock("@/components/navigation", () => ({
  SelectFacilityEmptyState: () => <div>Select a facility</div>,
}));

vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityContext: () => ({
    facilityId: "facility-1",
    selectedFacility: {
      code: "FAC-1",
      name: "Facility One",
      durabilityOption: facilityState.durabilityOption,
    },
  }),
}));

vi.mock("@/hooks/use-is-admin", () => ({
  useIsAdmin: () => adminState.isPlatformAdmin,
}));

vi.mock("@/hooks/use-organizations", () => ({
  useActiveOrganizationProfile: () => ({
    data: { id: "organization-1", name: "Organization One" },
  }),
}));

vi.mock("@/hooks/use-certification", () => ({
  useFacilityCertifierSummary: () => ({
    data: {
      isProduction: false,
      mapping: viewerState.mapping,
      viewerCanManage: viewerState.canManage,
    },
    isLoading: false,
  }),
}));

vi.mock("@/hooks/use-certifier-credentials", () => ({
  useOrgCertifierCredentialsStatus: () => ({
    data: { configured: viewerState.credentialsConfigured },
  }),
}));

vi.mock("./certification-health-panel", () => ({
  CertificationHealthPanel: () => <div>Health</div>,
}));

vi.mock("./certifier-settings-panel", () => ({
  CertifierSettingsPanel: () => <div>Certifier pane</div>,
}));

vi.mock("./env-banner", () => ({
  EnvBanner: () => <div>Environment</div>,
}));

vi.mock("./registry-source-visibility-settings", () => ({
  RegistrySourceVisibilitySettings: () => <div>Source visibility policy</div>,
}));

vi.mock("./removal-template-diagnostic-panel", () => ({
  RemovalTemplateDiagnosticPanel: () => <div>Template diagnostic pane</div>,
}));

beforeEach(() => {
  facilityState.durabilityOption = "200_year";
  urlState.section = null;
  viewerState.canManage = true;
  viewerState.credentialsConfigured = true;
  viewerState.mapping = null;
  adminState.isPlatformAdmin = false;
});

describe("CertificationSettings", () => {
  it("opens on the certifier pane when no section is requested", () => {
    const html = renderToStaticMarkup(<CertificationSettings />);

    expect(html).toContain("Certifier pane");
    // Every unmet credential/mapping/template check links here with no section
    // override, so the fallback has to be certifier rather than the first
    // category that happens to be listed.
    expect(html).toContain('aria-current="page"');
    // One pane at a time: no other section's content is in the document.
    expect(html).not.toContain("Emission estimates form");
    expect(html).not.toContain("Source visibility policy");
  });

  it("groups categories under the tier that owns them", () => {
    const html = renderToStaticMarkup(<CertificationSettings />);

    expect(html).toContain("Organization");
    expect(html).toContain("Facility");
    // One-word rail labels.
    expect(html).toContain("Certifier");
    expect(html).toContain("Sources");
    expect(html).toContain("Emissions");
    // Platform diagnostics belong to a platform admin, and useIsAdmin is false.
    expect(html).not.toContain("Diagnostics");
    expect(html).not.toContain("Template mapping");
  });

  it("shows Template mapping directly below Diagnostics only to Platform Admins", () => {
    adminState.isPlatformAdmin = true;

    const html = renderToStaticMarkup(<CertificationSettings />);
    const diagnosticsIndex = html.indexOf("Diagnostics");
    const mappingIndex = html.indexOf("Template mapping");

    expect(diagnosticsIndex).toBeGreaterThan(-1);
    expect(mappingIndex).toBeGreaterThan(diagnosticsIndex);
    expect(html.slice(diagnosticsIndex, mappingIndex)).not.toContain("</ul>");

    urlState.section = "template-mapping";
    const mappingPane = renderToStaticMarkup(<CertificationSettings />);
    expect(mappingPane).toContain("Template diagnostic pane");
    expect(mappingPane).toContain("Read-only for Platform Admins.");
    expect(mappingPane).not.toContain("Health");
  });

  it("resolves the retired connection and credentials keys onto the certifier pane", () => {
    // Both were their own category before the two were merged; links emitted
    // before that merge must not land on an empty console.
    for (const legacy of ["connection", "credentials"]) {
      urlState.section = legacy;
      const html = renderToStaticMarkup(<CertificationSettings />);
      expect(html).toContain("Certifier pane");
      expect(html).not.toContain("Source visibility policy");
    }
  });

  it("mounts the emission-estimates form for a 200-year facility", () => {
    urlState.section = "emission-estimates";

    const html = renderToStaticMarkup(<CertificationSettings />);

    expect(html).toContain("Emission estimates form");
    expect(html).not.toContain("Not used");
  });

  it("explains the emissions category instead of hiding it off the 200-year tier", () => {
    // The section used to render for nobody on a default deployment (ADR 0021
    // leaves 1000-year as the available tier), so the credit-batch "Open
    // emission estimates" fix link landed on a blank page.
    facilityState.durabilityOption = "1000_year";
    urlState.section = "emission-estimates";

    const html = renderToStaticMarkup(<CertificationSettings />);

    expect(html).not.toContain("Emission estimates form");
    expect(html).toContain("Not used");
    expect(html).toContain(
      "This facility is on the 1000-year durability tier",
    );
  });

  it("keeps the registry Source policy organization-wide", () => {
    urlState.section = "sources";

    const html = renderToStaticMarkup(<CertificationSettings />);

    expect(html).toContain("Source visibility policy");
    expect(html).toContain(
      "Whether new Isometric Sources start private to verifiers or public on the registry.",
    );
  });

  it("marks the certifier category while either half of the setup is missing", () => {
    // Keys and the project link are fixed in the same pane, so one marker
    // covers both — two dots for one destination would read as two jobs.
    viewerState.mapping = null;
    viewerState.credentialsConfigured = false;

    const withBlockers = renderToStaticMarkup(<CertificationSettings />);
    const blockerCount = (
      withBlockers.match(/aria-label="Needs attention"/g) ?? []
    ).length;
    expect(blockerCount).toBe(1);

    viewerState.mapping = { externalProjectId: "prj_1" };
    viewerState.credentialsConfigured = true;

    const clean = renderToStaticMarkup(<CertificationSettings />);
    expect(clean).not.toContain('aria-label="Needs attention"');
  });

  it("still marks the certifier category when only the project link is missing", () => {
    viewerState.mapping = null;
    viewerState.credentialsConfigured = true;

    const html = renderToStaticMarkup(<CertificationSettings />);

    expect(html).toContain('aria-label="Needs attention"');
  });

  it("keeps the certifier pane visible to a member who cannot manage it", () => {
    // Members cannot change the keys or the link, but the pane is where the
    // current connection state is readable — hiding it leaves them with no
    // answer to "is this facility connected?". Emissions is Owner/Admin only.
    viewerState.canManage = false;

    const html = renderToStaticMarkup(<CertificationSettings />);

    expect(html).toContain("Certifier");
    expect(html).toContain("Sources");
    expect(html).not.toContain("Emissions");
  });

  it("falls back to a visible section when the URL asks for one this viewer lacks", () => {
    // A deep link built by an Owner must not leave a member on an empty pane.
    viewerState.canManage = false;
    urlState.section = "emission-estimates";

    const html = renderToStaticMarkup(<CertificationSettings />);

    expect(html).toContain("Certifier pane");
    expect(html).not.toContain("Emission estimates form");

    urlState.section = "template-mapping";
    const platformDeepLink = renderToStaticMarkup(<CertificationSettings />);
    expect(platformDeepLink).toContain("Certifier pane");
    expect(platformDeepLink).not.toContain("Template diagnostic pane");
  });
});
