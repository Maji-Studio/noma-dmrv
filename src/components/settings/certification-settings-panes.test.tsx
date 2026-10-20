/**
 * The Certification panes that came out of `/certification/settings`:
 * Registry (status line instead of registry cards, keys first when none are
 * saved) and Facilities (project link, durability tier, soil reference only on
 * the 200-year tier).
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingsViewer } from "@/lib/settings/panes";
import {
  FacilitySettingsPane,
  SOIL_REFERENCE_NEEDS_LINK_TEXT,
  SOIL_REFERENCE_NOT_USED_TEXT,
} from "./facility-settings-pane";
import { REGISTRY_UNLOCKS_TEXT, RegistrySettingsPane } from "./registry-settings-pane";

const state = vi.hoisted(() => ({
  configured: true,
  mappingQuery: { data: { isConfigured: true }, isLoading: false, error: null } as {
    data?: { isConfigured: boolean };
    isLoading: boolean;
    error: Error | null;
  },
  summaryMapping: { externalProjectId: "prj_1", defaultSoilTemperatureC: 14 } as object | null,
  durabilityOption: "1000_year" as "1000_year" | "200_year",
}));

vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityContext: () => ({
    facilityId: "fac-1",
    selectedFacility: { id: "fac-1", code: "FAC-1", name: "Facility One", durabilityOption: state.durabilityOption, version: 1 },
  }),
}));
vi.mock("@/hooks/use-certification", () => ({
  certificationKeys: { all: ["certification"] },
  useFacilityCertifierSummary: () => ({
    data: { mapping: state.summaryMapping, viewerCanManage: true, isProduction: false },
    isLoading: false,
    error: null,
  }),
  useFacilityCertifierMapping: () => state.mappingQuery,
}));
vi.mock("@/hooks/use-certifier-credentials", () => ({
  useOrgCertifierCredentialsStatus: () => ({ data: { configured: state.configured } }),
}));
vi.mock("@/components/organizations/organization-certifier-credentials", () => ({
  OrganizationCertifierCredentials: () => <div>Keys form</div>,
}));
vi.mock("@/components/certification/registry-source-visibility-settings", () => ({
  RegistrySourceVisibilitySettings: () => <div>Source visibility policy</div>,
}));
vi.mock("@/components/certification/protocols-in-use", () => ({ ProtocolsInUse: () => <div>Protocols in use</div> }));
vi.mock("@/components/certification/facility-certifier-section", () => ({
  FacilityCertifierSection: () => <div>Project link</div>,
}));
vi.mock("@/components/admin/emission-estimates-form", () => ({
  EmissionEstimatesForm: () => <div>Soil reference form</div>,
}));
vi.mock("./durability-tier-settings", () => ({ DurabilityTierSettings: () => <div>Durability tier control</div> }));
vi.mock("@/components/navigation", () => ({ SelectFacilityEmptyState: () => <div>Select a facility</div> }));

const viewer: SettingsViewer = {
  organizationId: "org-1",
  organizationName: "Org One",
  organizationSlug: null,
  isPlatformAdmin: false,
  canManage: true,
  canManageApiKeys: true,
  registryKeysSaved: true,
  isProduction: false,
};

beforeEach(() => {
  state.configured = true;
  state.mappingQuery = { data: { isConfigured: true }, isLoading: false, error: null };
  state.summaryMapping = { externalProjectId: "prj_1", defaultSoilTemperatureC: 14 };
  state.durabilityOption = "1000_year";
});

describe("RegistrySettingsPane", () => {
  it("names the registry in a line and reports a working connection, with no registry cards", () => {
    const html = renderToStaticMarkup(<RegistrySettingsPane viewer={viewer} />);
    expect(html).toContain("Registry: <span class=\"font-medium\">Isometric</span>");
    expect(html).toContain("Connected.");
    expect(html).not.toContain("Coming soon");
    expect(html).not.toContain("puro");
    expect(html.indexOf("Keys form")).toBeLessThan(html.indexOf("Source visibility policy"));
    expect(html).toContain("Protocols in use");
  });

  it("leads with the keys form and says what saving them unlocks when none are saved", () => {
    state.configured = false;
    const html = renderToStaticMarkup(<RegistrySettingsPane viewer={viewer} />);
    expect(html).toContain("Keys not saved.");
    expect(html).toContain(REGISTRY_UNLOCKS_TEXT.replaceAll(",", ","));
    expect(html.indexOf("Keys not saved.")).toBeLessThan(html.indexOf("Keys form"));
  });

  it("reports failing keys only when the read says they cannot be used", () => {
    state.mappingQuery = { data: { isConfigured: false }, isLoading: false, error: null };
    const html = renderToStaticMarkup(<RegistrySettingsPane viewer={viewer} />);
    expect(html).toContain("Connection failing.");
    expect(html).toContain("Replace them below.");
  });

  it("stays neutral when the check itself fails", () => {
    state.mappingQuery = { isLoading: false, error: new Error("The server could not be reached.") };
    const html = renderToStaticMarkup(<RegistrySettingsPane viewer={viewer} />);
    expect(html).toContain("Couldn&#x27;t check the connection right now.");
    expect(html).not.toContain("Connection failing.");
    expect(html).not.toContain("Replace them");
  });

  it("shows a member the status without the keys form", () => {
    const html = renderToStaticMarkup(
      <RegistrySettingsPane viewer={{ ...viewer, canManage: false, registryKeysSaved: false }} />,
    );
    expect(html).toContain("Keys not saved.");
    expect(html).toContain("Owners and Admins save the Isometric keys here.");
    expect(html).not.toContain("Keys form");
    expect(html).toContain("Source visibility policy");
  });

  it("points an unlinked working facility on to Facilities", () => {
    state.summaryMapping = null;
    const html = renderToStaticMarkup(<RegistrySettingsPane viewer={viewer} />);
    expect(html).toContain("Facility One has no Isometric project link.");
    expect(html).toContain('href="/settings/facilities?facility=fac-1"');
  });
});

describe("FacilitySettingsPane", () => {
  it("holds the project link and the durability tier", () => {
    const html = renderToStaticMarkup(<FacilitySettingsPane viewer={viewer} />);
    expect(html).toContain("Project link");
    expect(html).toContain("Durability tier control");
  });

  it("hides the soil reference on the 1000-year tier behind one quiet line", () => {
    const html = renderToStaticMarkup(<FacilitySettingsPane viewer={viewer} />);
    expect(html).toContain(SOIL_REFERENCE_NOT_USED_TEXT);
    expect(html).not.toContain("Soil reference form");
    expect(html).not.toContain("Not used");
  });

  it("offers the soil reference on the 200-year tier", () => {
    state.durabilityOption = "200_year";
    const html = renderToStaticMarkup(<FacilitySettingsPane viewer={viewer} />);
    expect(html).toContain("Soil reference form");
    expect(html).not.toContain(SOIL_REFERENCE_NOT_USED_TEXT);
  });

  it("asks for the project link before the soil reference on an unlinked 200-year facility", () => {
    state.durabilityOption = "200_year";
    state.summaryMapping = null;
    const html = renderToStaticMarkup(<FacilitySettingsPane viewer={viewer} />);
    expect(html).toContain(SOIL_REFERENCE_NEEDS_LINK_TEXT);
    expect(html).not.toContain("Soil reference form");
  });

  it("shows a member the saved soil reference read-only", () => {
    state.durabilityOption = "200_year";
    const html = renderToStaticMarkup(<FacilitySettingsPane viewer={{ ...viewer, canManage: false }} />);
    expect(html).not.toContain("Soil reference form");
    expect(html).toContain("Reference soil temperature");
    expect(html).toContain(">14<");
  });
});
